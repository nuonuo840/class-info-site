/* ============================================================
   班级信息静态网页系统 —— 数据层（app.js）

   作用：集中管理「班级目录」和「同学名单」两份数据，供三个页面共用：
         index.html  首页 —— 选择专业/班级，跳转到具体班级
         roster.html 名单页 —— 展示某个班级的同学名单
         form.html   录入页 —— 往某个班级里添加同学

   数据分两层：

     1. 班级目录（学校 / 专业 / 年级 / 班级）
        - 预置班级写在下面的 DEFAULT_CLASSES 里，任何浏览器都能看到；
        - 首页「新建班级」创建的班级存在浏览器本地（localStorage）。

     2. 同学名单（属于某个具体班级）
        - 每个班级单独存一份，键名是 classInfoSite.students.<班级id>
        - 所以班级之间互不干扰：改 1 班的名单不会影响到 2 班。

   数据存在浏览器本地（localStorage），不需要任何后端服务器。
   注意：数据只存在于当前这台电脑、当前这个浏览器里，
         换设备或清空浏览器数据就会回到默认名单。
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     一、常量与默认数据
     ============================================================ */

  // 学校名称：全站统一显示。要换成真实学校名，只改这一处即可。
  var SCHOOL_NAME = '某高校';

  /*
    localStorage 键名。
    加前缀是为了避免和其他网站的数据撞车（同一域名下所有页面共用一个存储空间）。
  */
  var STUDENT_PREFIX = 'classInfoSite.students.';  // 各班名单：后面接班级 id
  var CLASSES_KEY = 'classInfoSite.classes';       // 页面上新建的班级目录

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
    { id: 'cs-2026-1', school: SCHOOL_NAME, major: '计算机科学与技术', grade: '2026', name: '1 班' },
    { id: 'cs-2026-2', school: SCHOOL_NAME, major: '计算机科学与技术', grade: '2026', name: '2 班' },
    { id: 'se-2026-1', school: SCHOOL_NAME, major: '软件工程',         grade: '2026', name: '1 班' },
    { id: 'ai-2026-1', school: SCHOOL_NAME, major: '人工智能',         grade: '2026', name: '1 班' }
  ];

  /*
    各班的默认名单：首次打开、或本地还没有该班数据时使用。

    要批量增加 / 修改同学，直接改这里即可 —— 数组顺序就是名单顺序，序号会自动生成。
    contact 一栏写手机号，只写 11 位数字（如 13800000001），名单页会自动显示成 138-0000-0001。

    注意：这里的数据全为占位示例，不是真实学生信息。
  */
  var DEFAULT_ROSTERS = {
    // 计算机科学与技术 2026 级 1 班（12 人）
    'cs-2026-1': [
      { name: '张三',   sid: '2026110101', contact: '13800000001' },
      { name: '王雨桐', sid: '2026110102', contact: '13800000002' },
      { name: '陈嘉禾', sid: '2026110103', contact: '13800000003' },
      { name: '张思远', sid: '2026110104', contact: '13800000004' },
      { name: '刘星宇', sid: '2026110105', contact: '13800000005' },
      { name: '赵梦琪', sid: '2026110106', contact: '13800000006' },
      { name: '孙浩然', sid: '2026110107', contact: '13800000007' },
      { name: '周静怡', sid: '2026110108', contact: '13800000008' },
      { name: '吴子墨', sid: '2026110109', contact: '13800000009' },
      { name: '郑一鸣', sid: '2026110110', contact: '13800000010' },
      { name: '黄书瑶', sid: '2026110111', contact: '13800000011' },
      { name: '徐子涵', sid: '2026110112', contact: '13800000012' }
    ],
    // 计算机科学与技术 2026 级 2 班
    'cs-2026-2': [
      { name: '李婉清', sid: '2026110201', contact: '13800000021' },
      { name: '何嘉树', sid: '2026110202', contact: '13800000022' },
      { name: '马晓月', sid: '2026110203', contact: '13800000023' }
    ],
    // 软件工程 2026 级 1 班
    'se-2026-1': [
      { name: '林清和', sid: '2026120101', contact: '13800000031' },
      { name: '罗宇轩', sid: '2026120102', contact: '13800000032' },
      { name: '宋知微', sid: '2026120103', contact: '13800000033' }
    ],
    // 人工智能 2026 级 1 班
    'ai-2026-1': [
      { name: '许听澜', sid: '2026130101', contact: '13800000041' },
      { name: '曹星辞', sid: '2026130102', contact: '13800000042' },
      { name: '邓南乔', sid: '2026130103', contact: '13800000043' }
    ]
  };

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

  /* ============================================================
     三、班级目录相关接口
     ============================================================ */

  /*
    列出全部班级：预置的 + 页面上新建的，按专业/年级/班级名排好序。

    去重规则：以 id 为准。若新建班级的 id 与预置班撞了（正常不会），保留预置的那个。
  */
  function listClasses() {
    var all = DEFAULT_CLASSES.slice();
    var seen = {};
    var i;

    for (i = 0; i < all.length; i++) seen[all[i].id] = true;

    var custom = loadCustomClasses();
    for (i = 0; i < custom.length; i++) {
      var item = custom[i];
      if (!item || !item.id || seen[item.id]) continue;
      seen[item.id] = true;
      all.push(item);
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
    var school = trim(info && info.school) || SCHOOL_NAME;

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
    list[index].contact = normalizeContact(student.contact);

    if (!save(classId, list)) return { ok: false, reason: 'storage' };

    return { ok: true, count: list.length, student: list[index] };
  }

  /* 关键词匹配：姓名、学号或手机号包含关键词就算命中；关键词为空时全部命中。
     手机号做了「忽略连字符」处理：输入 13800000001 或 138-0000-0001 都能搜到。 */
  function match(student, keyword) {
    if (!keyword) return true;

    var kw = String(keyword).toLowerCase();
    var name = String(student.name).toLowerCase();
    var sid = String(student.sid).toLowerCase();
    var contact = String(student.contact || '').toLowerCase();

    if (name.indexOf(kw) > -1 || sid.indexOf(kw) > -1 || contact.indexOf(kw) > -1) {
      return true;
    }

    var kwDigits = kw.replace(/\D/g, '');
    return kwDigits !== '' && contact.replace(/\D/g, '').indexOf(kwDigits) > -1;
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

  /* 把所有班级的名单、以及页面上新建的班级全部清掉，恢复到出厂状态（调试用） */
  function resetAll() {
    try {
      var classes = listClasses();
      for (var i = 0; i < classes.length; i++) {
        localStorage.removeItem(STUDENT_PREFIX + classes[i].id);
      }
      localStorage.removeItem(CLASSES_KEY);
    } catch (e) {
      // 同上，忽略
    }
  }

  /* ============================================================
     五、网址参数工具
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
     六、老数据迁移
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
     七、对外暴露的接口
     ============================================================ */

  window.ClassData = {
    // 常量与默认数据（排查问题、或有页面想直接读默认值时用得上）
    SCHOOL: SCHOOL_NAME,
    STUDENT_PREFIX: STUDENT_PREFIX,
    CLASSES_KEY: CLASSES_KEY,
    DEFAULT_CLASSES: DEFAULT_CLASSES,
    DEFAULT_ROSTERS: DEFAULT_ROSTERS,

    // 班级目录
    listClasses: listClasses,
    getClass: getClass,
    getClassName: getClassName,
    listMajors: listMajors,
    listClassesByMajor: listClassesByMajor,
    createClass: createClass,

    // 同学名单（第一个参数都是班级 id）
    load: load,
    save: save,
    add: add,
    find: find,
    update: update,
    match: match,
    reset: reset,
    resetAll: resetAll,

    // 网址参数
    param: param,
    getClassFromUrl: getClassFromUrl,
    buildUrl: buildUrl
  };
})();
