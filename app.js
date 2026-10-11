/* ============================================================
   班级信息静态网页系统 —— 数据层（app.js）
   作用：集中管理「同学名单」这一份数据，供 roster.html（名单页）
         和 form.html（录入页）共用。

   为什么单独抽一个文件：
     - 名单不再写死在 HTML 里，加人/改人只改下面这一个数组；
     - 名单页的序号、人数统计全部自动计算，不用手动同步；
     - 录入页提交的数据能真正存下来，并立刻出现在名单页。

   数据存在浏览器本地（localStorage），不需要任何后端服务器。
   注意：数据只存在于当前这台电脑、当前这个浏览器里，
         换设备或清空浏览器数据就会回到默认名单。
   ============================================================ */

(function () {
  'use strict';

  // localStorage 里存放名单的键名（加前缀，避免与其他站点冲突）
  var STORAGE_KEY = 'classInfoSite.students';

  // 默认名单：首次打开、或本地还没有数据时使用。
  // 要增加 / 修改同学，直接改这个数组即可 —— 顺序就是名单顺序，序号会自动生成。
  // contact 一栏写手机号，只写 11 位数字（如 13800000001），名单页会自动显示成 138-0000-0001。
  var DEFAULT_STUDENTS = [
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
  ];

  /* 规整手机号：只保留数字。
     用户在输入框里写成 138-0000-0001 或 138 0000 0001 都没关系，
     存进来统一变成 13800000001，保证格式一致、方便比对。 */
  function normalizeContact(contact) {
    return String(contact == null ? '' : contact).replace(/\D/g, '');
  }

  /* 读取名单：本地有数据就用本地的，没有就用默认名单 */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_STUDENTS.slice();

      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_STUDENTS.slice();

      return parsed;
    } catch (e) {
      // 浏览器禁用本地存储（如隐私模式）、或数据被损坏时，退回默认名单
      return DEFAULT_STUDENTS.slice();
    }
  }

  /* 保存整份名单，返回是否成功 */
  function save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 新增一位同学
     返回 { ok: true, count: 总数 }
       或 { ok: false, reason: 'duplicate' | 'storage' } */
  function add(student) {
    var list = load();

    // 学号唯一性校验：同一个学号不允许录入两次
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

    if (!save(list)) return { ok: false, reason: 'storage' };
    return { ok: true, count: list.length };
  }

  /* 按学号查找一位同学，找不到返回 null
     （录入页在学号重复时用它取出原有信息，向用户确认是否覆盖） */
  function find(sid) {
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].sid === sid) return list[i];
    }
    return null;
  }

  /* 按学号更新已有同学的信息（学号本身不变）
     返回 { ok: true, count: 总数 }
       或 { ok: false, reason: 'notfound' | 'storage' } */
  function update(sid, student) {
    var list = load();

    for (var i = 0; i < list.length; i++) {
      if (list[i].sid === sid) {
        list[i].name = student.name;
        list[i].contact = normalizeContact(student.contact);

        if (!save(list)) return { ok: false, reason: 'storage' };
        return { ok: true, count: list.length };
      }
    }

    return { ok: false, reason: 'notfound' };
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

  /* 清空本地数据、恢复成默认名单
     （调试用：在浏览器控制台执行 ClassData.reset() 后刷新页面） */
  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // 忽略：存储不可用时本来也没有数据可清
    }
    return load();
  }

  // 挂到 window 上，供各页面脚本调用
  window.ClassData = {
    KEY: STORAGE_KEY,        // 存储键名，排查问题时用得上
    DEFAULT: DEFAULT_STUDENTS,
    load: load,
    save: save,
    add: add,
    find: find,
    update: update,
    match: match,
    reset: reset
  };
})();
