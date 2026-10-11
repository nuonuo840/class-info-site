/* ============================================================
   班级信息静态网页系统 —— 数据层（app.js）

   作用：集中管理「班级目录」和「同学名单」两份数据，供三个页面共用：
         index.html  首页 —— 选择专业/班级，跳转到具体班级
         roster.html 名单页 —— 展示某个班级的同学名单
         form.html   录入页 —— 往某个班级里添加同学

   数据分两层：

     1. 班级目录（学校 / 专业 / 年级 / 班级）
        - 预置班级写在下面的 DEFAULT_CLASSES 里，任何浏览器都能看到；
        - 首页「新建班级」创建的班级存在浏览器本地（localStorage）；
        - 两类班级都能在首页删掉：新建的直接从本地目录里移除，
          预置的记进一份「隐藏名单」（见 loadHiddenClasses），效果一样。

     2. 同学名单（属于某个具体班级）
        - 每个班级单独存一份，键名是 classInfoSite.students.<班级id>
        - 所以班级之间互不干扰：改 1 班的名单不会影响到 2 班。
        - 每位同学的字段：
            name    姓名
            sid     学号（本班内唯一）
            gender  性别 —— '男' / '女' / ''（未填写）
            contact 手机号（只存 11 位数字，显示时才加连字符）

   换一所学校要改的地方只有两处，都在本文件顶部：
     · SCHOOL_NAME 附近 —— 学校名（现在也能在首页「学校设置」里改）
     · SID_MIN / SID_MAX / SID_ALLOW_LETTER —— 学号规则

   数据存在浏览器本地（localStorage），不需要任何后端服务器。
   注意：数据只存在于当前这台电脑、当前这个浏览器里，
         换设备或清空浏览器数据就会回到「初始的空名单」。
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     一、常量与默认数据
     ============================================================ */

  /*
    ============================================================
    学号规则 —— 换一所学校，只改这三个数字/开关就够了。

      不同学校的学号规则差别很大：8 位的、10 位的、12 位的，甚至带字母的。
      录入页的输入框校验、名单页的行内编辑校验、批量导入时的格式检查，
      全部以这三个常量为准，所以不需要去三个页面里各改一遍。

      SID_MIN / SID_MAX     学号允许的位数范围（写一样就是固定位数）
      SID_ALLOW_LETTER      false = 只允许数字；true = 数字和英文字母都可以

      举个例子：
        SID_MIN = 8,  SID_MAX = 12            → 8~12 位数字
        SID_MIN = 10, SID_MAX = 10            → 固定 10 位数字（不少学校的常见做法）
        SID_MIN = 4,  SID_MAX = 20,
        SID_ALLOW_LETTER = true               → 4~20 位数字或字母（最宽松）
    ============================================================
  */
  var SID_MIN = 4;
  var SID_MAX = 20;
  var SID_ALLOW_LETTER = false;

  /* 下面两个由上面三个自动算出来，不用手动改 */

  // 学号校验用的正则（由上面的规则拼出来）
  var SID_PATTERN = new RegExp(
    '^' + (SID_ALLOW_LETTER ? '[0-9A-Za-z]' : '[0-9]')
    + '{' + SID_MIN + ',' + SID_MAX + '}$'
  );

  // 给用户看的格式说明，例如「4~20 位数字」「固定 10 位数字」
  function sidHint() {
    var digits = SID_ALLOW_LETTER ? '数字或字母' : '数字';

    if (SID_MIN === SID_MAX) return '固定 ' + SID_MIN + ' 位' + digits;
    return SID_MIN + '~' + SID_MAX + ' 位' + digits;
  }

  /*
    按当前规则生成一个合规的学号示例，用于提示文案。
    比如规则是「固定 8 位数字」时会给出 20261101，而不是一个 10 位的例子。
  */
  function sidExample() {
    var example = '2026110113';       // 先拿一个常见的 10 位学号当底子

    if (SID_MAX < example.length) return example.slice(0, SID_MAX);

    while (example.length < SID_MIN) example += '0';
    return example;
  }

  /*
    检查一个学号是否合法。

    返回 { ok: true } 或 { ok: false, reason: 'empty' | 'format' }

    空值单独给一个 reason，是为了让调用方能说出「学号没填」和
    「学号格式不对」的区别，提示更准确。
  */
  function checkSid(sid) {
    var value = trim(sid);

    if (!value) return { ok: false, reason: 'empty' };
    if (!SID_PATTERN.test(value)) return { ok: false, reason: 'format' };

    return { ok: true };
  }

  /*
    学校名称。

    现在可以在首页的「学校设置」里随时改名，改完存在浏览器本地，
    所以这里只是「还没设置过」时用的默认值，不是必须改的常量了。
  */
  var DEFAULT_SCHOOL = '某高校';

  /*
    localStorage 键名。
    加前缀是为了避免和其他网站的数据撞车（同一域名下所有页面共用一个存储空间）。
  */
  var STUDENT_PREFIX = 'classInfoSite.students.';  // 各班名单：后面接班级 id
  var CLASSES_KEY = 'classInfoSite.classes';       // 页面上新建的班级目录
  var SCHOOL_KEY = 'classInfoSite.schoolName';     // 用户在首页设置过的学校名
  var HIDDEN_KEY = 'classInfoSite.hiddenClasses';  // 被删掉的「预置班级」id 列表

  /*
    上一版（只支持单个班级时）用的存储键，仅用于一次性数据迁移。
    老用户浏览器里可能有这个键，迁移函数会把它搬到第一个班级下，避免数据"凭空消失"。
  */
  var LEGACY_STUDENT_KEY = 'classInfoSite.students';

  /*
    预置班级目录。
    id 是班级的唯一标识，会出现在网址里（roster.html?c=cs-2026-1）。
    要增删预置班级，直接改这个数组；新增班级时记得给一个不重复的 id。

    字段说明：
      id     班级唯一标识（英文/数字，短且好认，会出现在网址里）
      school 学校名
      major  专业名
      grade  年级（入学年份，如 2026）
      name   班级名（如 "1 班"）
  */
  var DEFAULT_CLASSES = [
    { id: 'cs-2026-1', school: DEFAULT_SCHOOL, major: '计算机科学与技术', grade: '2026', name: '1 班' },
    { id: 'cs-2026-2', school: DEFAULT_SCHOOL, major: '计算机科学与技术', grade: '2026', name: '2 班' },
    { id: 'se-2026-1', school: DEFAULT_SCHOOL, major: '软件工程',         grade: '2026', name: '1 班' },
    { id: 'ai-2026-1', school: DEFAULT_SCHOOL, major: '人工智能',         grade: '2026', name: '1 班' }
  ];

  /*
    各班的「预置名单」：本地还没有这个班的数据时，用它作为初始内容。

    现在默认是空的 —— 也就是说，一台从来没打开过本站的电脑，
    打开任何一个班看到的都是空名单，需要自己到「信息录入」页添加同学。
    （以前这里塞了 21 个假名字当示例，现在全部去掉了。）

    如果你想让某个班一打开就自带名单（比如全班同学都固定、不想每次手工录），
    可以按下面的格式往里填 —— 数组顺序就是名单顺序，序号会自动生成：

      'cs-2026-1': [
        { name: '张三', sid: '2026110101', contact: '13800000001' }
      ],

    contact 一栏写手机号，只写 11 位数字，名单页会自动显示成 138-0000-0001。
    注意：填在这里的内容会随代码一起发布，所有访问者都能看到 ——
         不要放真实的手机号等个人隐私信息。
  */
  var DEFAULT_ROSTERS = {};

  /* ============================================================
     二、工具函数
     ============================================================ */

  /* 规整手机号：只保留数字。
     用户在输入框里写成 138-0000-0001 或 138 0000 0001 都没关系，
     存进来统一变成 13800000001，保证格式一致、方便比对。 */
  function normalizeContact(contact) {
    return String(contact == null ? '' : contact).replace(/\D/g, '');
  }

  /* 去掉首尾空格；null / undefined 一律当空字符串处理 */
  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  /*
    规整性别：统一成 '男' / '女' / ''（未填写）。

    为什么要规整：性别从三个地方进来 —— 录入页的下拉框、名单页的行内编辑、
    以及批量导入（那里可能是别人手打的 Excel，写成「男生」「M」「female」都有）。
    统一成两种情况，比对的代码才不用到处写兼容。

    认不出来的值一律当成「未填写」，不报错 —— 性别不像学号，填错也不影响查重。
  */
  function normalizeGender(value) {
    var v = trim(value);
    if (!v) return '';

    if (v === '男' || /^m(ale)?$/i.test(v) || v.indexOf('男') > -1) return '男';
    if (v === '女' || /^f(emale)?$/i.test(v) || v.indexOf('女') > -1) return '女';

    return '';
  }

  /*
    读取当前学校名。
    优先用用户在首页设置过的那份；没设置过（或存的内容是空的）就用默认值。
  */
  function getSchoolName() {
    try {
      var saved = trim(localStorage.getItem(SCHOOL_KEY));
      if (saved) return saved;
    } catch (e) {
      // 浏览器禁用本地存储时，安静地退回默认值
    }
    return DEFAULT_SCHOOL;
  }

  /*
    设置学校名，存进浏览器本地。

    返回 { ok: true, name: 实际生效的名字 }
       或 { ok: false, reason: 'storage' }

    传空（或只有空格）视为「恢复默认」—— 会把设置项删掉，
    而不是留一个空字符串在学校名该显示的地方。
  */
  function setSchoolName(name) {
    var value = trim(name);

    try {
      if (!value) {
        localStorage.removeItem(SCHOOL_KEY);
        return { ok: true, name: DEFAULT_SCHOOL };
      }
      localStorage.setItem(SCHOOL_KEY, value);
      return { ok: true, name: value };
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }
  }

  /* 班级目录排序：按「专业 → 年级 → 班级名」排列。
     用 localeCompare 并指定中文，保证"软件工程"和"计算机科学与技术"的先后符合中文习惯。 */
  function compareClasses(a, b) {
    var keyA = a.major + '\u0000' + a.grade + '\u0000' + a.name;
    var keyB = b.major + '\u0000' + b.grade + '\u0000' + b.name;
    return keyA.localeCompare(keyB, 'zh-Hans-CN');
  }

  /* 读取「页面上新建的班级」。读不到或数据损坏时返回空数组，不影响预置班级 */
  function loadCustomClasses() {
    try {
      var raw = localStorage.getItem(CLASSES_KEY);
      if (!raw) return [];

      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // 浏览器禁用本地存储（如隐私模式）、或数据被损坏
      return [];
    }
  }

  /*
    读取「被删掉的预置班级」id 列表。

    写在代码里的预置班级（DEFAULT_CLASSES）删不掉自己 —— 代码一加载它又回来了。
    所以删除预置班级时，把它的 id 记到这里，listClasses() 会把它们过滤掉，
    效果上等同于「删掉了」。首页「清空本机全部数据」会一并清掉这份记录，
    于是预置班级全部回来；也可以用 restoreHidden() 单独恢复。
  */
  function loadHiddenClasses() {
    try {
      var raw = localStorage.getItem(HIDDEN_KEY);
      if (!raw) return [];

      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /* ============================================================
     三、班级目录相关接口
     ============================================================ */

  /*
    列出全部班级：预置的 + 页面上新建的，按专业/年级/班级名排好序。

    去重规则：以 id 为准。若新建班级的 id 与预置班撞了（正常不会），保留预置的那个。
  */
  function listClasses() {
    var hidden = loadHiddenClasses();
    var all = [];
    var seen = {};
    var i;

    // 预置班级：跳过被删掉的那些（见 loadHiddenClasses）
    for (i = 0; i < DEFAULT_CLASSES.length; i++) {
      if (hidden.indexOf(DEFAULT_CLASSES[i].id) > -1) continue;
      all.push(DEFAULT_CLASSES[i]);
    }

    for (i = 0; i < all.length; i++) seen[all[i].id] = true;

    var custom = loadCustomClasses();
    for (i = 0; i < custom.length; i++) {
      var item = custom[i];
      if (!item || !item.id || seen[item.id]) continue;
      if (hidden.indexOf(item.id) > -1) continue;
      seen[item.id] = true;
      all.push(item);
    }

    /*
      学校名统一换成「当前设置的那个」再往外给。
      这样在首页改一次校名，所有班级（含以前新建的）都跟着变，
      不需要回头去改每一条数据。
      注意要新建对象，别就地改 —— 否则会污染 DEFAULT_CLASSES。
    */
    var school = getSchoolName();
    for (i = 0; i < all.length; i++) {
      all[i] = {
        id: all[i].id,
        school: school,
        major: all[i].major,
        grade: all[i].grade,
        name: all[i].name
      };
    }

    all.sort(compareClasses);
    return all;
  }

  /* 按 id 找班级，找不到返回 null */
  function getClass(classId) {
    if (!classId) return null;

    var all = listClasses();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === classId) return all[i];
    }
    return null;
  }

  /*
    班级的显示名称：把学校之外的三个字段拼起来。
    例如 { major:'计算机科学与技术', grade:'2026', name:'1 班' }
      → "计算机科学与技术 2026 级 1 班"
  */
  function getClassName(cls) {
    if (!cls) return '';
    return cls.major + ' ' + cls.grade + ' 级 ' + cls.name;
  }

  /* 列出全部专业名（去重、已排序），供首页的「专业」下拉框使用 */
  function listMajors() {
    var classes = listClasses();
    var majors = [];
    var seen = {};

    for (var i = 0; i < classes.length; i++) {
      var major = classes[i].major;
      if (seen[major]) continue;
      seen[major] = true;
      majors.push(major);
    }

    return majors;
  }

  /* 列出某个专业下的全部班级，已排序，供首页的「班级」下拉框使用 */
  function listClassesByMajor(major) {
    var classes = listClasses();
    var result = [];

    for (var i = 0; i < classes.length; i++) {
      if (classes[i].major === major) result.push(classes[i]);
    }

    return result;
  }

  /* 生成一个不会与现有班级重复的 id。
     形如 c + 时间戳的 36 进制，够短也够唯一（同一毫秒内创建两个才会撞）。 */
  function makeClassId() {
    var existing = {};
    var classes = listClasses();
    var i;

    for (i = 0; i < classes.length; i++) existing[classes[i].id] = true;

    var id = 'c' + Date.now().toString(36);
    while (existing[id]) {
      id = id + Math.floor(Math.random() * 10);   // 极小概率的兜底
    }
    return id;
  }

  /*
    新建一个班级（存到浏览器本地，不写入代码文件）。

    返回 { ok: true, cls: {...} }
       或 { ok: false, reason: 'invalid' | 'duplicate' | 'storage' }

    失败原因：
      invalid   —— 专业、年级或班级名为空
      duplicate —— 同一个专业、同一个年级下已经有同名的班级了
      storage   —— 浏览器本地存储不可用（如隐私模式）
  */
  function createClass(info) {
    var major = trim(info && info.major);
    var grade = trim(info && info.grade);
    var name = trim(info && info.name);
    var school = trim(info && info.school) || getSchoolName();

    if (!major || !grade || !name) return { ok: false, reason: 'invalid' };

    // 防重：同一学校 + 同一专业 + 同一年级 + 同一班级名，视为重复
    var existing = listClasses();
    for (var i = 0; i < existing.length; i++) {
      var c = existing[i];
      if (c.school === school && c.major === major && c.grade === grade && c.name === name) {
        return { ok: false, reason: 'duplicate' };
      }
    }

    var cls = {
      id: makeClassId(),
      school: school,
      major: major,
      grade: grade,
      name: name
    };

    var custom = loadCustomClasses();
    custom.push(cls);

    try {
      localStorage.setItem(CLASSES_KEY, JSON.stringify(custom));
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }

    return { ok: true, cls: cls };
  }

  /*
    删除一个班级（连带它的整份名单）。

    返回 { ok: true, name: 班级全名 }
       或 { ok: false, reason: 'invalid' | 'notfound' | 'storage' }

    分两种情况处理：
      · 页面上新建的班级 —— 直接从本地班级目录里删掉；
      · 写在代码里的预置班级 —— 代码删不掉，于是把 id 记进「隐藏名单」，
        列表里不再出现，效果一样（见 loadHiddenClasses）。

    删除是不可逆的（名单会一起没），所以页面调用前一定会先弹窗确认。
  */
  function removeClass(classId) {
    if (!classId) return { ok: false, reason: 'invalid' };

    var cls = getClass(classId);
    if (!cls) return { ok: false, reason: 'notfound' };

    var isPreset = false;
    var i;
    for (i = 0; i < DEFAULT_CLASSES.length; i++) {
      if (DEFAULT_CLASSES[i].id === classId) { isPreset = true; break; }
    }

    try {
      if (isPreset) {
        var hidden = loadHiddenClasses();
        if (hidden.indexOf(classId) === -1) hidden.push(classId);
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
      } else {
        var custom = loadCustomClasses();
        var kept = [];
        for (i = 0; i < custom.length; i++) {
          if (!custom[i] || custom[i].id === classId) continue;
          kept.push(custom[i]);
        }
        localStorage.setItem(CLASSES_KEY, JSON.stringify(kept));
      }

      // 班级都没了，它的名单也没有留着的意义
      localStorage.removeItem(STUDENT_PREFIX + classId);

      return { ok: true, name: getClassName(cls) };
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }
  }

  /*
    把「被删掉的预置班级」全部恢复回来。

    首页「数据管理」里有对应按钮。删除预置班级只是把它藏起来（见 loadHiddenClasses），
    所以这里只要清掉那份隐藏记录即可，班级本身和它的默认数据一直都在代码里。
  */
  function restoreHidden() {
    try {
      localStorage.removeItem(HIDDEN_KEY);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }
  }

  /* ============================================================
     四、同学名单相关接口（每个接口的第一个参数都是「班级 id」）
     ============================================================ */

  /* 读取某个班级的名单：本地有数据就用本地的，没有就用默认名单 */
  function load(classId) {
    if (!classId) return [];

    var fallback = DEFAULT_ROSTERS[classId] || [];

    try {
      var raw = localStorage.getItem(STUDENT_PREFIX + classId);
      if (!raw) return fallback.slice();

      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return fallback.slice();

      return parsed;
    } catch (e) {
      // 浏览器禁用本地存储、或数据被损坏时，退回默认名单
      return fallback.slice();
    }
  }

  /* 保存某个班级的整份名单，返回是否成功 */
  function save(classId, list) {
    if (!classId) return false;

    try {
      localStorage.setItem(STUDENT_PREFIX + classId, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 往某个班级里新增一位同学
     返回 { ok: true, count: 总数 }
       或 { ok: false, reason: 'duplicate' | 'storage' } */
  function add(classId, student) {
    var list = load(classId);

    // 学号唯一性校验：同一个班级里不允许出现两个相同学号
    for (var i = 0; i < list.length; i++) {
      if (list[i].sid === student.sid) {
        return { ok: false, reason: 'duplicate' };
      }
    }

    list.push({
      name: student.name,
      sid: student.sid,
      gender: normalizeGender(student.gender),
      contact: normalizeContact(student.contact)
    });

    if (!save(classId, list)) return { ok: false, reason: 'storage' };
    return { ok: true, count: list.length };
  }

  /* 在某个班级里按学号查找一位同学，找不到返回 null
     （录入页在学号重复时用它取出原有信息，向用户确认是否覆盖） */
  function find(classId, sid) {
    var list = load(classId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].sid === sid) return list[i];
    }
    return null;
  }

  /* 在某个班级里按学号更新已有同学的信息

     第二个参数 oldSid 是「这位同学原来（改之前）的学号」，用来定位记录；
     第三个参数 student 里可以带上新的学号 —— 也就是学号本身也允许修改。

     返回 { ok: true, count: 总数, student: 更新后的记录 }
       或 { ok: false, reason: 'notfound' | 'duplicate' | 'storage' }

     三种失败原因：
       notfound  —— 找不到原学号对应的同学（可能名单已被别处改动）
       duplicate —— 新学号已被「其他」同学占用（自己用回自己原来的学号不算冲突）
       storage   —— 浏览器本地存储不可用（如隐私模式）
  */
  function update(classId, oldSid, student) {
    var list = load(classId);
    var index = -1;

    // 第一步：用「原学号」找到要修改的那条记录
    for (var i = 0; i < list.length; i++) {
      if (list[i].sid === oldSid) {
        index = i;
        break;
      }
    }

    if (index === -1) return { ok: false, reason: 'notfound' };

    var newSid = trim(student.sid);

    // 第二步：如果学号被改了，检查新学号有没有被别的同学占用
    // （排除自己这一条，否则「不改学号直接改姓名」会被误判成重复）
    if (newSid !== oldSid) {
      for (var j = 0; j < list.length; j++) {
        if (j !== index && list[j].sid === newSid) {
          return { ok: false, reason: 'duplicate' };
        }
      }
    }

    // 第三步：写入新内容
    list[index].name = trim(student.name);
    list[index].sid = newSid;
    list[index].gender = normalizeGender(student.gender);
    list[index].contact = normalizeContact(student.contact);

    if (!save(classId, list)) return { ok: false, reason: 'storage' };

    return { ok: true, count: list.length, student: list[index] };
  }

  /* 关键词匹配：姓名、学号、手机号或性别包含关键词就算命中；关键词为空时全部命中。
     手机号做了「忽略连字符」处理：输入 13800000001 或 138-0000-0001 都能搜到。
     搜「男」「女」可以把全班男生 / 女生一次筛出来。 */
  function match(student, keyword) {
    if (!keyword) return true;

    var kw = String(keyword).toLowerCase();
    var name = String(student.name).toLowerCase();
    var sid = String(student.sid).toLowerCase();
    var gender = String(student.gender || '').toLowerCase();
    var contact = String(student.contact || '').toLowerCase();

    if (name.indexOf(kw) > -1 || sid.indexOf(kw) > -1
      || gender.indexOf(kw) > -1 || contact.indexOf(kw) > -1) {
      return true;
    }

    var kwDigits = kw.replace(/\D/g, '');
    return kwDigits !== '' && contact.replace(/\D/g, '').indexOf(kwDigits) > -1;
  }

  /*
    从某个班级里删除一位同学（按学号定位）。

    返回 { ok: true, count: 删除后本班人数, student: 被删掉的那位 }
       或 { ok: false, reason: 'notfound' | 'storage' }

    删除是不可逆的，所以页面调用它之前一定会先弹窗确认。
  */
  function remove(classId, sid) {
    if (!classId) return { ok: false, reason: 'notfound' };

    var list = load(classId);
    var kept = [];
    var removed = null;

    for (var i = 0; i < list.length; i++) {
      if (!removed && list[i].sid === sid) {
        removed = list[i];
        continue;   // 跳过这一条，相当于删掉它
      }
      kept.push(list[i]);
    }

    if (!removed) return { ok: false, reason: 'notfound' };
    if (!save(classId, kept)) return { ok: false, reason: 'storage' };

    return { ok: true, count: kept.length, student: removed };
  }

  /*
    一次删除多位同学（传一串学号）。

    返回 { ok: true, removed: 实际删掉的人数, count: 删除后本班人数 }
       或 { ok: false, reason: 'invalid' | 'notfound' | 'storage' }
  */
  function removeMany(classId, sids) {
    if (!classId || !sids || !sids.length) return { ok: false, reason: 'invalid' };

    var list = load(classId);
    var kept = [];
    var removedCount = 0;
    var i;

    for (i = 0; i < list.length; i++) {
      if (sids.indexOf(list[i].sid) > -1) removedCount++;
      else kept.push(list[i]);
    }

    if (removedCount === 0) return { ok: false, reason: 'notfound' };
    if (!save(classId, kept)) return { ok: false, reason: 'storage' };

    return { ok: true, removed: removedCount, count: kept.length };
  }

  /*
    把若干位同学从一个班「移动」到另一个班（传一串学号）。

    返回 { ok: true, moved: 成功移动的人数, conflict: [学号...], count: 目标班人数 }
       或 { ok: false, reason: 'invalid' | 'same' | 'conflict' | 'storage', conflict: [...] }

    冲突规则：目标班里已经有人用了相同学号 —— 这些同学会被留在原班不动，
             学号列在 conflict 里，由页面告诉用户哪几位没搬过去。
             这比"直接覆盖目标班的人"安全得多。
  */
  function moveStudents(fromClassId, toClassId, sids) {
    if (!fromClassId || !toClassId || !sids || !sids.length) {
      return { ok: false, reason: 'invalid', conflict: [] };
    }
    if (fromClassId === toClassId) {
      return { ok: false, reason: 'same', conflict: [] };
    }

    var from = load(fromClassId);
    var to = load(toClassId);

    var used = {};                 // 目标班里已经占用的学号
    var i;
    for (i = 0; i < to.length; i++) used[to[i].sid] = true;

    var moving = [];
    var staying = [];
    var conflict = [];

    for (i = 0; i < from.length; i++) {
      var s = from[i];

      if (sids.indexOf(s.sid) === -1) {
        staying.push(s);           // 没被选中，留在原班
        continue;
      }

      if (used[s.sid]) {
        conflict.push(s.sid);      // 目标班学号撞车，跳过
        staying.push(s);
        continue;
      }

      used[s.sid] = true;
      moving.push(s);
    }

    if (moving.length === 0) {
      return { ok: false, reason: 'conflict', conflict: conflict };
    }

    // 先写目标班，成功后再写原班；第二步失败就把第一步回滚，避免一个人出现两份
    if (!save(toClassId, to.concat(moving))) {
      return { ok: false, reason: 'storage', conflict: conflict };
    }
    if (!save(fromClassId, staying)) {
      save(toClassId, to);         // 回滚
      return { ok: false, reason: 'storage', conflict: conflict };
    }

    return {
      ok: true,
      moved: moving.length,
      conflict: conflict,
      count: to.length + moving.length
    };
  }

  /*
    按给定的学号顺序，重新排列某个班的名单。

    第二个参数 sids 是「期望的顺序」——数组里没提到的学号会按原相对顺序补在末尾，
    所以只传一部分也不会把人弄丢。名单页的「上移 / 下移」就是用它实现的：
    算出交换位置后的完整顺序数组，再传进来。

    返回 { ok: true, count: 总数 }
       或 { ok: false, reason: 'invalid' | 'storage' }
  */
  function reorder(classId, sids) {
    if (!classId || !sids || !sids.length) return { ok: false, reason: 'invalid' };

    var list = load(classId);
    var picked = [];
    var rest = [];
    var i, j;

    for (i = 0; i < list.length; i++) {
      if (sids.indexOf(list[i].sid) > -1) picked.push(list[i]);
      else rest.push(list[i]);
    }

    // 把「被点名」的那几条按 sids 指定的先后顺序排好
    var ordered = [];
    for (i = 0; i < sids.length; i++) {
      for (j = 0; j < picked.length; j++) {
        if (picked[j] && picked[j].sid === sids[i]) {
          ordered.push(picked[j]);
          picked[j] = null;      // 置空，防止同一个学号被排进去两次
          break;
        }
      }
    }

    if (!save(classId, ordered.concat(rest))) return { ok: false, reason: 'storage' };
    return { ok: true, count: ordered.length + rest.length };
  }

  /* ============================================================
     五、按学号排序 / 批量导入
     ============================================================ */

  /*
    两个学号的先后比较规则：

      · 都是纯数字 —— 先比位数（9 位的排在 10 位的前面），位数相同再比大小。
        这样在「学号位数不统一」的情况下也算符合直觉。
      · 一个纯数字、一个带字母 —— 纯数字的排在前面。
      · 都带字母 —— 用中文排序规则、并把其中的数字段按数值比
        （所以 a2 会排在 a10 前面，而不是按字符比出 a10 < a2）。

    为什么要按位数先比一次：如果直接按字符串比，"999999999"（9 位）
    会大于 "2026110101"（10 位），但按长度先排就符合「短学号在前」的直觉。
  */
  function compareSid(a, b) {
    var x = String(a.sid == null ? '' : a.sid);
    var y = String(b.sid == null ? '' : b.sid);

    var xNum = /^\d+$/.test(x);
    var yNum = /^\d+$/.test(y);

    if (xNum && yNum) {
      if (x.length !== y.length) return x.length - y.length;
      if (x === y) return 0;
      return x < y ? -1 : 1;
    }

    if (xNum !== yNum) return xNum ? -1 : 1;

    return x.localeCompare(y, 'zh-Hans-CN', { numeric: true });
  }

  /*
    把某个班的名单按学号从小到大重排，并写回本地存储。

    返回 { ok: true, count: 总数 }
       或 { ok: false, reason: 'invalid' | 'storage' }

    注意这是「真的改了名单顺序」（序号会跟着变），不是只在页面上临时排一下 ——
    因为本项目的「序号」含义就是「同学在完整名单里的位置」，两者必须一致。
    名单页在调用它之前会存一份快照，所以排错了可以用「撤销」退回去。
  */
  function sortBySid(classId) {
    if (!classId) return { ok: false, reason: 'invalid' };

    var list = load(classId);
    if (list.length === 0) return { ok: true, count: 0 };

    list.sort(compareSid);

    if (!save(classId, list)) return { ok: false, reason: 'storage' };
    return { ok: true, count: list.length };
  }

  /* ---------- 批量导入：解析文本 ---------- */

  /*
    表头文字的识别词。导入时如果第一行命中它们，就认为那是表头，
    并按表头名去定位每一列 —— 这样「导出 CSV → 在 Excel 里改 → 再导回来」
    能完美对上，即使列的顺序被调整过。
  */
  var COLUMN_HINTS = {
    name:    ['姓名', '名字', '学生', 'name'],
    gender:  ['性别', 'gender', 'sex'],
    sid:     ['学号', '学籍号', 'sid'],
    contact: ['手机', '电话', '联系方式', '联系', 'contact', 'phone', 'tel', 'mobile']
  };

  /* 把一行文本按分隔符拆成若干格。
     不能简单 split —— Excel 导出的 CSV 里，内容含逗号的格子会被双引号包起来，
     内部的两个连续引号表示一个真的引号。这几行就是处理这件事的。 */
  function splitDelimitedLine(line, delimiter) {
    var cells = [];
    var current = '';
    var inQuotes = false;
    var i;

    for (i = 0; i < line.length; i++) {
      var ch = line.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            current += '"';     // 连着的两个引号 = 内容里真的一个引号
            i++;
          } else {
            inQuotes = false;   // 引号到这里收尾
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);

    for (i = 0; i < cells.length; i++) cells[i] = trim(cells[i]);
    return cells;
  }

  /* 在第 cells 行里找「哪一格是某一类字段」，找不到返回 -1 */
  function detectColumn(cells, kind) {
    var hints = COLUMN_HINTS[kind];
    var i, j;

    for (i = 0; i < cells.length; i++) {
      var cell = String(cells[i]).toLowerCase();
      if (!cell) continue;

      for (j = 0; j < hints.length; j++) {
        if (cell.indexOf(hints[j].toLowerCase()) > -1) return i;
      }
    }
    return -1;
  }

  /* 这一行是不是表头（含有「姓名」「学号」之类的字眼） */
  function looksLikeHeader(cells) {
    for (var i = 0; i < cells.length; i++) {
      var cell = String(cells[i]).toLowerCase();
      if (!cell) continue;
      if (cell.indexOf('姓名') > -1 || cell.indexOf('名字') > -1) return true;
      if (cell.indexOf('学号') > -1 || cell.indexOf('sid') > -1) return true;
    }
    return false;
  }

  /* 这一格像不像「性别」：空的也算像（性别允许不填） */
  function looksLikeGender(cell) {
    var v = trim(cell);
    return v === '' || normalizeGender(v) !== '';
  }

  /*
    解析一段「表格文本」，支持两种来源：

      ① CSV 文件的全文
      ② 直接从 Excel 里复制粘贴的内容（Excel 复制出来是「制表符分隔」的文本）

    返回：
      {
        ok: true,
        delimiter: ',' 或 '\t',
        columns:   { name, gender, sid, contact }  —— 最终采用的列位置（-1 表示没有）
        header:    表头文字数组（没有表头时是 null）,
        rows: [
          { line: 2, ok: true, name, gender, sid, contact },
          { line: 5, ok: false, reason: 'sid-format', raw: '…' }   —— 这一行有问题
        ],
        total: 行数, usable: 可用行数, errorCount: 问题行数
      }
    或 { ok: false, reason: 'empty' }

    列位置的判定规则（按优先级）：
      1. 第一行被认出是表头 → 按表头文字定位每一列（最准，推荐）
      2. 没有表头 → 按位置猜：
         · 3 列及以下：姓名 / 学号 / 手机号
         · 4 列及以上：姓名 / 性别 / 学号 / 手机号
         · 如果第 1 格是纯数字、第 2 格又不像性别（比如导出的 CSV 删掉了表头、
           但「序号」那一列还在），就整体往右挪一位；
           挪完之后再看一格：第 3 格像性别就有性别列，否则按没有性别列处理。
  */
  function parseRosterText(text) {
    var raw = String(text == null ? '' : text).replace(/^\ufeff/, '');  // 去掉可能的 BOM
    if (!trim(raw)) return { ok: false, reason: 'empty' };

    // 统一换行，再拆成一行行、去掉空行
    var lines = raw.replace(/\r\n?/g, '\n').split('\n');
    var i;

    // 分隔符：整段文本只看第一行有内容的行 —— 有制表符就是 Excel 粘贴，否则按 CSV 逗号
    var delimiter = ',';
    for (i = 0; i < lines.length; i++) {
      if (!trim(lines[i])) continue;
      if (lines[i].indexOf('\t') > -1) delimiter = '\t';
      break;
    }

    var header = null;
    var columns = null;
    var rows = [];
    var seenSid = {};

    // 第一行有内容的行，先拆出来看看是不是表头
    var headerRow = -1;
    var firstCells = null;
    for (i = 0; i < lines.length; i++) {
      if (!trim(lines[i])) continue;
      firstCells = splitDelimitedLine(lines[i], delimiter);
      headerRow = i;
      break;
    }

    if (!firstCells) return { ok: false, reason: 'empty' };

    /*
      数据从哪一行开始。
      是表头 → 从它的下一行开始；不是表头 → 它本身就是数据，不能跳过。
      （这里踩过坑：早先无论有没有表头都从下一行开始，
        结果「从 Excel 粘贴、不带表头」时会默默丢掉第一行。）
    */
    var startLine = headerRow;

    if (looksLikeHeader(firstCells)) {
      header = firstCells;
      startLine = headerRow + 1;

      columns = {
        name: detectColumn(firstCells, 'name'),
        gender: detectColumn(firstCells, 'gender'),
        sid: detectColumn(firstCells, 'sid'),
        contact: detectColumn(firstCells, 'contact')
      };
      // 表头里没写「学号」之类能认出来的字眼，就退回按位置猜
      if (columns.sid === -1) columns = null;
    }

    for (i = startLine; i < lines.length; i++) {
      if (!trim(lines[i])) continue;      // 空行直接跳过，不算错误

      var cells = splitDelimitedLine(lines[i], delimiter);
      var map = columns;

      if (!map) {
        /* 按位置猜列 */

        if (cells.length >= 4) {
          if (/^\d+$/.test(cells[0]) && !looksLikeGender(cells[1])) {
            /*
              第一格是个序号、第二格又不像性别 —— 说明整行往右挪了一位
              （典型场景：导出的 CSV 把表头那一行删了再导回来）。
              再往下看一格：第三格像性别就说明有性别列，否则按没有性别列处理。
            */
            map = looksLikeGender(cells[2])
              ? { name: 1, gender: 2, sid: 3, contact: 4 }
              : { name: 1, gender: -1, sid: 2, contact: 3 };
          } else {
            map = { name: 0, gender: 1, sid: 2, contact: 3 };
          }
        } else {
          // 三列或更少：按「姓名 / 学号 / 手机号」对应，性别留空
          map = { name: 0, gender: -1, sid: 1, contact: 2 };
        }
      }

      var pick = function (index) {
        return (index >= 0 && index < cells.length) ? cells[index] : '';
      };

      var row = {
        line: i + 1,
        name: trim(pick(map.name)),
        gender: normalizeGender(pick(map.gender)),
        sid: trim(pick(map.sid)),
        contact: normalizeContact(pick(map.contact))
      };

      // 逐项校验，第一个出问题的地方作为这一行的失败原因
      var sidCheck = checkSid(row.sid);

      if (!row.name) {
        row.ok = false;
        row.reason = 'no-name';
      } else if (!sidCheck.ok) {
        row.ok = false;
        row.reason = sidCheck.reason === 'empty' ? 'no-sid' : 'sid-format';
      } else if (row.contact && !/^1[3-9]\d{9}$/.test(row.contact)) {
        row.ok = false;
        row.reason = 'contact-format';
      } else if (seenSid[row.sid]) {
        // 同一个文件里出现了两次相同学号 —— 只认第一条，后面这条跳过
        row.ok = false;
        row.reason = 'dup-in-file';
        row.dupLine = seenSid[row.sid];
      } else {
        row.ok = true;
        seenSid[row.sid] = i + 1;
      }

      if (!row.ok) row.raw = trim(lines[i]);

      rows.push(row);
    }

    var usable = 0;
    for (i = 0; i < rows.length; i++) if (rows[i].ok) usable++;

    return {
      ok: true,
      delimiter: delimiter,
      columns: columns,
      header: header,
      rows: rows,
      total: rows.length,
      usable: usable,
      errorCount: rows.length - usable
    };
  }

  /*
    把解析好的若干行并入某个班级的名单。

    第三个参数 mode：
      'skip'      —— 跳过与本班已有学号重复的行（默认，最安全）
      'overwrite' —— 用新数据覆盖本班相同的那条记录

    返回 {
      ok: true,
      added, updated, skipped,   // 新增 / 覆盖 / 因重复跳过 的行数
      invalid,                   // 因格式问题被丢掉的行数
      conflicts: [学号…],         // 被跳过的那些学号（页面用来提示是哪几位）
      count                      // 导入后本班总人数
    }
    或 { ok: false, reason: 'invalid' | 'storage' }

    无论哪种模式，都不会删除本班原有的同学。
  */
  function mergeRoster(classId, rows, mode) {
    if (!classId || !rows || !rows.length) return { ok: false, reason: 'invalid' };

    var overwrite = (mode === 'overwrite');
    var list = load(classId);
    var indexOf = {};
    var i;

    for (i = 0; i < list.length; i++) indexOf[list[i].sid] = i;

    var added = 0;
    var updated = 0;
    var skipped = 0;
    var invalid = 0;
    var conflicts = [];

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var name = trim(row && row.name);
      var sid = trim(row && row.sid);

      // 兜底再校一次：格式不对的行绝不写进名单
      if (!name || !checkSid(sid).ok) { invalid++; continue; }

      var student = {
        name: name,
        sid: sid,
        gender: normalizeGender(row.gender),
        contact: normalizeContact(row.contact)
      };

      if (indexOf[sid] === undefined) {
        indexOf[sid] = list.length;
        list.push(student);
        added++;
      } else if (overwrite) {
        list[indexOf[sid]] = student;
        updated++;
      } else {
        skipped++;
        conflicts.push(sid);
      }
    }

    if (added === 0 && updated === 0) {
      // 名单一个字都没变，就不用写存储了
      return {
        ok: true, added: 0, updated: 0, skipped: skipped,
        invalid: invalid, conflicts: conflicts, count: list.length
      };
    }

    if (!save(classId, list)) return { ok: false, reason: 'storage' };

    return {
      ok: true, added: added, updated: updated, skipped: skipped,
      invalid: invalid, conflicts: conflicts, count: list.length
    };
  }

  /* 清空某个班级的本地名单、恢复成默认名单
     （调试用：在浏览器控制台执行 ClassData.reset('cs-2026-1') 后刷新页面） */
  function reset(classId) {
    if (!classId) return [];

    try {
      localStorage.removeItem(STUDENT_PREFIX + classId);
    } catch (e) {
      // 忽略：存储不可用时本来也没有数据可清
    }
    return load(classId);
  }

  /*
    清空本机全部数据，恢复到「刚打开本站」的出厂状态：
      · 所有班级的名单
      · 页面上新建的班级
      · 设置过的学校名

    首页的「数据管理」里有对应按钮，会先弹窗确认再调用它。
  */
  function resetAll() {
    try {
      var classes = listClasses();
      for (var i = 0; i < classes.length; i++) {
        localStorage.removeItem(STUDENT_PREFIX + classes[i].id);
      }
      localStorage.removeItem(CLASSES_KEY);
      localStorage.removeItem(SCHOOL_KEY);
      localStorage.removeItem(HIDDEN_KEY);   // 被删掉的预置班级也一并恢复
    } catch (e) {
      // 存储不可用时本来就没有数据可清，忽略即可
    }
  }

  /* ============================================================
     六、网址参数工具
     ============================================================ */

  /* 取网址里的查询参数，例如 roster.html?c=cs-2026-1 里的 c。
     没有这个参数时返回空字符串。 */
  function param(key) {
    var search = window.location.search || '';
    if (!search) return '';

    var pairs = search.replace(/^\?/, '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;

      var eq = pairs[i].indexOf('=');
      var rawKey = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      var rawValue = eq === -1 ? '' : pairs[i].slice(eq + 1);

      // 网址里的中文和特殊符号是编码过的，要还原；"+" 代表空格
      if (decodeURIComponent(rawKey.replace(/\+/g, ' ')) === key) {
        return decodeURIComponent(rawValue.replace(/\+/g, ' '));
      }
    }
    return '';
  }

  /* 取网址参数 c 指定的班级对象，没指定或班级不存在时返回 null */
  function getClassFromUrl() {
    return getClass(param('c'));
  }

  /* 拼一个带班级参数的网址，供各页面生成导航链接用 */
  function buildUrl(page, classId) {
    return classId ? page + '?c=' + encodeURIComponent(classId) : page;
  }

  /* ============================================================
     七、老数据迁移
     ============================================================ */

  /*
    上一版只支持单个班级，名单存在 classInfoSite.students 这个键里。
    现在改成按班级分键存放，所以把老数据搬到「第一个预置班级」名下，
    免得之前录入的信息看起来凭空消失了。

    只在「新键里还没有数据」时搬一次；老键随即删除，避免反复复制。
  */
  function migrateLegacy() {
    try {
      var legacy = localStorage.getItem(LEGACY_STUDENT_KEY);
      if (!legacy) return;

      var firstClass = DEFAULT_CLASSES[0];
      if (firstClass) {
        var newKey = STUDENT_PREFIX + firstClass.id;
        if (!localStorage.getItem(newKey)) {
          localStorage.setItem(newKey, legacy);
        }
      }

      localStorage.removeItem(LEGACY_STUDENT_KEY);
    } catch (e) {
      // 存储不可用时无事可做
    }
  }

  migrateLegacy();

  /* ============================================================
     八、对外暴露的接口
     ============================================================ */

  window.ClassData = {
    // 常量与默认数据（排查问题、或有页面想直接读默认值时用得上）
    SCHOOL: DEFAULT_SCHOOL,        // 默认校名；当前生效的那个请用 getSchoolName()
    DEFAULT_SCHOOL: DEFAULT_SCHOOL,

    // 学号规则（在文件顶部改，页面只读不改）
    SID_MIN: SID_MIN,
    SID_MAX: SID_MAX,
    SID_ALLOW_LETTER: SID_ALLOW_LETTER,
    SID_PATTERN: SID_PATTERN,
    sidHint: sidHint,
    sidExample: sidExample,
    checkSid: checkSid,

    // 性别规整：'男' / '女' / ''（未填写）
    normalizeGender: normalizeGender,

    STUDENT_PREFIX: STUDENT_PREFIX,
    CLASSES_KEY: CLASSES_KEY,
    SCHOOL_KEY: SCHOOL_KEY,
    HIDDEN_KEY: HIDDEN_KEY,
    DEFAULT_CLASSES: DEFAULT_CLASSES,
    DEFAULT_ROSTERS: DEFAULT_ROSTERS,

    // 学校名（首页可以改，存在浏览器本地）
    getSchoolName: getSchoolName,
    setSchoolName: setSchoolName,

    // 班级目录
    listClasses: listClasses,
    getClass: getClass,
    getClassName: getClassName,
    listMajors: listMajors,
    listClassesByMajor: listClassesByMajor,
    createClass: createClass,
    removeClass: removeClass,
    restoreHidden: restoreHidden,

    // 同学名单（第一个参数都是班级 id）
    load: load,
    save: save,
    add: add,
    find: find,
    update: update,
    remove: remove,
    removeMany: removeMany,
    moveStudents: moveStudents,
    reorder: reorder,
    sortBySid: sortBySid,
    match: match,
    reset: reset,
    resetAll: resetAll,

    // 批量导入（名单页的「导入」面板用）
    parseRosterText: parseRosterText,
    mergeRoster: mergeRoster,

    // 网址参数
    param: param,
    getClassFromUrl: getClassFromUrl,
    buildUrl: buildUrl
  };
})();
