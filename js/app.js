/* =========================================================
   كراسة المعلم الليبي الرقمية — منطق التطبيق
   لا يحتاج أي مكتبات خارجية: JavaScript خالصة
   ========================================================= */

(function () {
  "use strict";

  /* ---------------- 1) أدوات مساعدة ---------------- */

  var KEYS = {
    basic: "kmt.basic.v1",          // البيانات الأساسية
    preps: "kmt.preps.v1",          // التحضيرات
    notes: "kmt.notes.v1",          // دفتر الملاحظات
    activities: "kmt.activities.v1", // بنك الأنشطة
    tests: "kmt.tests.v1",          // التقويم والاختبارات
    plans: "kmt.plans.v1",          // الخطط
    students: "kmt.students.v1",    // متابعة التلاميذ (بيانات + درجات + حضور)
    diffs: "kmt.diffs.v1",          // الفروق الفردية
    account: "kmt.account.v1",      // بيانات الدخول (البريد + تجزئة كلمة المرور)
    session: "kmt.session.v1"       // علامة "تذكرني" (لا تُخزَّن كلمة المرور هنا)
  };

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /** قراءة قيمة من التخزين المحلي بأمان */
  function storageGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("تعذّرت قراءة البيانات المحفوظة:", err);
      return fallback;
    }
  }

  /** حفظ قيمة في التخزين المحلي بأمان */
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error("تعذّر حفظ البيانات:", err);
      toast("⚠️ تعذّر الحفظ! قد تكون مساحة المتصفح ممتلئة.");
      return false;
    }
  }

  /** تحويل نص إلى صيغة آمنة لعرضه في HTML */
  function esc(text) {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** معرّف فريد */
  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  /** تنسيق التاريخ (2026/10/10) بغض النظر عن لغة الجهاز */
  function fmtDate(iso) {
    if (!iso) return "";
    var parts = String(iso).split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  /** تاريخ اليوم بصيغة حقل التاريخ */
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /** رسالة منبثقة قصيرة */
  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-show"); }, 2600);
  }

  /* ---------------- 1ب) قفل التطبيق (حساب + كلمة مرور) ---------------- */

  var SALT = "kmt-lock-v1::";

  /** تجزئة كلمة المرور SHA-256 (مع بديل احتياطي إن لم يتوفر) */
  function hashPassword(text) {
    var str = SALT + text;
    var canUseSubtle = window.crypto && window.crypto.subtle &&
      typeof window.crypto.subtle.digest === "function" && typeof TextEncoder !== "undefined";

    if (canUseSubtle) {
      try {
        var data = new TextEncoder().encode(str);
        return window.crypto.subtle.digest("SHA-256", data).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ("0" + b.toString(16)).slice(-2);
          }).join("");
        }).catch(function () { return simpleHash(text); });
      } catch (err) {
        return Promise.resolve(simpleHash(text));
      }
    }
    return Promise.resolve(simpleHash(text));
  }

  /** تجزئة احتياطية بسيطة (للمتصفحات القديمة فقط) */
  function simpleHash(text) {
    var str = SALT + text;
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      h1 = ((h1 ^ str.charCodeAt(i)) * 0x01000193) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return "fnv-" + h1.toString(16) + "-" + h2.toString(16);
  }

  function getAccount() {
    var acc = storageGet(KEYS.account, null);
    return (acc && typeof acc === "object" && acc.email && acc.hash) ? acc : null;
  }

  function setAuthError(msg) {
    var box = $("#authError");
    if (!box) return;
    if (!msg) { box.textContent = ""; box.classList.add("is-hidden"); return; }
    box.textContent = msg;
    box.classList.remove("is-hidden");
  }

  /** إظهار لوحة الإنشاء أو الدخول */
  function showAuthPanel(mode) {
    var setup = mode === "setup";
    $("#setupForm").classList.toggle("is-hidden", !setup);
    $("#loginForm").classList.toggle("is-hidden", setup);
    $("#forgotBox").classList.add("is-hidden");
    setAuthError("");

    if (setup) {
      $("#authTitle").textContent = "إنشاء حساب جديد";
      $("#authSub").textContent = "اختاري بريدًا إلكترونيًا وكلمة مرور لحماية الكراسة على هذا الجهاز.";
      setTimeout(function () { var e = document.getElementById("suEmail"); if (e) e.focus(); }, 100);
    } else {
      $("#authTitle").textContent = "تسجيل الدخول";
      $("#authSub").textContent = "أدخلي بريدكِ الإلكتروني وكلمة المرور لفتح الكراسة.";
      setTimeout(function () { var e = document.getElementById("liEmail"); if (e) e.focus(); }, 100);
    }
  }

  /** فتح الكراسة */
  function unlockApp() {
    document.body.classList.remove("auth-locked");
    $("#suPass").value = "";
    $("#suPass2").value = "";
    $("#liPass").value = "";
  }

  /** قفل الكراسة (زر الخروج) */
  function lockApp() {
    try { window.localStorage.removeItem(KEYS.session); } catch (e) {}
    try { window.sessionStorage.removeItem(KEYS.session); } catch (e) {}
    document.body.classList.add("auth-locked");
    showAuthPanel(getAccount() ? "login" : "setup");
    toast("🔒 تم قفل الكراسة");
  }

  function clearAuthSession() {
    try {
      window.localStorage.removeItem(KEYS.session);
      window.sessionStorage.removeItem(KEYS.session);
    } catch (e) {}
  }

  function bindAuth() {
    /* إنشاء الحساب لأول مرة */
    $("#setupForm").addEventListener("submit", function (e) {
      e.preventDefault();

      var email = ($("#suEmail").value || "").trim().toLowerCase();
      var pass = $("#suPass").value || "";
      var pass2 = $("#suPass2").value || "";

      var errs = [];
      if (!email) errs.push("البريد الإلكتروني");
      if (pass.length < 4) errs.push("كلمة مرور من 4 خانات فأكثر");
      if (pass !== pass2) errs.push("أن تتطابق كلمة المرور مع تأكيدها");

      if (errs.length) { setAuthError("الرجاء: " + errs.join("، ")); return; }

      hashPassword(pass).then(function (hash) {
        var acc = { email: email, hash: hash, createdAt: new Date().toISOString() };
        if (!storageSet(KEYS.account, acc)) return;
        try { window.localStorage.setItem(KEYS.session, "1"); } catch (err) {}
        unlockApp();
        toast("✅ تم إنشاء الحساب، مرحبًا بكِ");
      });
    });

    /* تسجيل الدخول */
    $("#loginForm").addEventListener("submit", function (e) {
      e.preventDefault();

      var acc = getAccount();
      if (!acc) { showAuthPanel("setup"); return; }

      var email = ($("#liEmail").value || "").trim().toLowerCase();
      var pass = $("#liPass").value || "";

      if (!email || !pass) {
        setAuthError("الرجاء إدخال البريد الإلكتروني وكلمة المرور.");
        return;
      }

      hashPassword(pass).then(function (hash) {
        if (email !== acc.email || hash !== acc.hash) {
          setAuthError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
          $("#liPass").value = "";
          $("#liPass").focus();
          return;
        }
        var store = $("#liRemember").checked ? window.localStorage : window.sessionStorage;
        try { store.setItem(KEYS.session, "1"); } catch (err) {}
        setAuthError("");
        unlockApp();
        toast("🔓 مرحبًا بكِ مجددًا");
      });
    });

    /* نسيت كلمة المرور؟ */
    $("#btnForgot").addEventListener("click", function () {
      $("#forgotBox").classList.toggle("is-hidden");
    });

    $("#btnCancelReset").addEventListener("click", function () {
      $("#forgotBox").classList.add("is-hidden");
    });

    $("#btnResetAccount").addEventListener("click", function () {
      var ok = window.confirm(
        "سيتم حذف بيانات الدخول (البريد وكلمة المرور) فقط، مع الإبقاء على كل بياناتكِ " +
        "(التحضيرات، الخطط، التلاميذ، الملاحظات…).\n\nهل تريدين المتابعة؟"
      );
      if (!ok) return;

      try { window.localStorage.removeItem(KEYS.account); } catch (err) {}
      clearAuthSession();
      $("#liEmail").value = "";
      $("#liPass").value = "";
      $("#suEmail").value = "";
      showAuthPanel("setup");
      toast("♻️ يمكنكِ الآن إنشاء حساب جديد");
    });

    /* زر القفل في الشريط العلوي */
    $("#btnLogout").addEventListener("click", function () {
      var ok = window.confirm("سيتم قفل الكراسة، وبياناتكِ تبقى محفوظة.\nهل تريدين القفل الآن؟");
      if (!ok) return;
      lockApp();
    });
  }

  /** تحديد ما يُعرض عند فتح التطبيق */
  function initAuth() {
    var acc = getAccount();
    var hasSession = false;
    try {
      hasSession = window.localStorage.getItem(KEYS.session) === "1" ||
        (window.sessionStorage && window.sessionStorage.getItem(KEYS.session) === "1");
    } catch (e) {}

    // نبدأ دائمًا من وضع مقفل، ثم نقرر الفتح
    document.body.classList.add("auth-locked");

    if (acc && hasSession) { unlockApp(); return; }
    showAuthPanel(acc ? "login" : "setup");
  }

  /* ---------------- 2) التنقل بين الأقسام ---------------- */

  var VIEWS = ["home", "basic-data", "prep", "plans", "activities",
               "assessment", "students", "differences", "notes"];

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = "home";

    $all(".view").forEach(function (v) { v.classList.remove("is-active"); });
    var target = document.getElementById("view-" + name);
    if (target) target.classList.add("is-active");

    $all(".nav-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });

    if (window.location.hash !== "#" + name) {
      window.location.hash = name;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindNavigation() {
    $all(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showView(btn.getAttribute("data-view"));
      });
    });

    $all("[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showView(btn.getAttribute("data-goto"));
      });
    });

    window.addEventListener("hashchange", function () {
      showView(window.location.hash.replace("#", ""));
    });

    // فتح القسم المطلوب في الرابط الأول
    var initial = window.location.hash.replace("#", "");
    showView(initial || "home");
  }

  /* ---------------- 3) البيانات الأساسية ---------------- */

  var BASIC_FIELDS = ["bdTeacher", "bdSchool", "bdSubject", "bdGrade", "bdYear", "bdStage"];

  function loadBasic() {
    var data = storageGet(KEYS.basic, {});
    BASIC_FIELDS.forEach(function (id) {
      if (data[id]) document.getElementById(id).value = data[id];
    });
  }

  function getBasic() {
    var data = {};
    BASIC_FIELDS.forEach(function (id) {
      data[id] = (document.getElementById(id).value || "").trim();
    });
    return data;
  }

  function bindBasic() {
    $("#basicForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (storageSet(KEYS.basic, getBasic())) {
        toast("✅ حُفظت البيانات الأساسية");
      }
    });

    $("#bdClear").addEventListener("click", function () {
      if (!window.confirm("هل تريدين مسح جميع حقول البيانات الأساسية؟")) return;
      BASIC_FIELDS.forEach(function (id) { document.getElementById(id).value = ""; });
      toast("تم مسح الحقول (لم يُحفظ إلا بعد الضغط على حفظ)");
    });
  }

  /* ---------------- 4) التحضير اليومي ---------------- */

  var PREP_FIELDS = [
    { id: "prepGrade",       label: "الصف والشعبة" },
    { id: "prepDate",        label: "التاريخ" },
    { id: "prepTitle",       label: "عنوان الدرس" },
    { id: "prepCognitive",   label: "الأهداف المعرفية" },
    { id: "prepSkill",       label: "الأهداف المهارية" },
    { id: "prepAffective",   label: "الأهداف الوجدانية" },
    { id: "prepIntro",       label: "التمهيد" },
    { id: "prepTools",       label: "الوسائل" },
    { id: "prepStrategies",  label: "استراتيجيات التدريس" },
    { id: "prepSteps",       label: "خطوات الدرس" },
    { id: "prepAssessment",  label: "التقويم" },
    { id: "prepHomework",    label: "الواجب المنزلي" }
  ];

  function getPreps() {
    var list = storageGet(KEYS.preps, []);
    return Array.isArray(list) ? list : [];
  }

  function savePreps(list) {
    return storageSet(KEYS.preps, list);
  }

  function readPrepForm() {
    var data = {};
    PREP_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });
    return data;
  }

  function resetPrepForm() {
    $("#prepForm").reset();
    $("#prepId").value = "";
    $("#prepDate").value = todayISO();
    // تعبئة الصف من البيانات الأساسية إن كان فارغًا
    var bdGrade = document.getElementById("bdGrade").value.trim();
    if (bdGrade) document.getElementById("prepGrade").value = bdGrade;
    $("#prepFormTitle").textContent = "تحضير جديد";
    $("#prepError").classList.add("is-hidden");
  }

  function openPrepForm() {
    $("#prepFormCard").classList.remove("is-hidden");
    $("#prepFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("prepGrade").focus(); }, 300);
  }

  function closePrepForm() {
    $("#prepFormCard").classList.add("is-hidden");
  }

  function submitPrep(e) {
    e.preventDefault();

    var data = readPrepForm();
    var missing = [];
    if (!data.prepGrade) missing.push("الصف والشعبة");
    if (!data.prepDate) missing.push("التاريخ");
    if (!data.prepTitle) missing.push("عنوان الدرس");

    var errBox = $("#prepError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#prepId").value;
    var list = getPreps();

    if (id) {
      // تعديل تحضير موجود
      var found = false;
      list = list.map(function (p) {
        if (p.id === id) {
          found = true;
          return Object.assign({}, p, data, { updatedAt: new Date().toISOString() });
        }
        return p;
      });
      if (!found) { toast("⚠️ لم يتم العثور على التحضير المطلوب تعديله"); return; }
      if (savePreps(list)) toast("✅ تم تعديل التحضير");
    } else {
      // تحضير جديد
      var prep = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data
      );
      list.unshift(prep);
      if (savePreps(list)) toast("✅ حُفظ التحضير بنجاح");
    }

    resetPrepForm();
    closePrepForm();
    renderPreps();
  }

  function editPrep(id) {
    var prep = getPreps().filter(function (p) { return p.id === id; })[0];
    if (!prep) return;

    resetPrepForm();
    $("#prepId").value = prep.id;
    PREP_FIELDS.forEach(function (f) {
      if (prep[f.id] !== undefined) document.getElementById(f.id).value = prep[f.id];
    });
    $("#prepFormTitle").textContent = "تعديل التحضير: " + (prep.prepTitle || "");
    openPrepForm();
  }

  function deletePrep(id) {
    var prep = getPreps().filter(function (p) { return p.id === id; })[0];
    if (!prep) return;

    var ok = window.confirm("هل تريدين حذف تحضير «" + (prep.prepTitle || "بدون عنوان") + "» نهائيًا؟");
    if (!ok) return;

    var list = getPreps().filter(function (p) { return p.id !== id; });
    if (savePreps(list)) {
      toast("🗑️ تم حذف التحضير");
      renderPreps();
    }
  }

  function renderPreps() {
    var list = getPreps();
    var query = ($("#prepSearch").value || "").trim().toLowerCase();

    var filtered = list;
    if (query) {
      filtered = list.filter(function (p) {
        var haystack = [
          p.prepTitle, p.prepGrade, p.prepDate, fmtDate(p.prepDate),
          p.prepStrategies, p.prepTools
        ].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#prepCount").textContent = list.length;
    var container = $("#prepList");
    var emptyBox = $("#prepEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      emptyBox.innerHTML = query
        ? "لا توجد نتائج مطابقة لـ «" + esc($("#prepSearch").value) + "»."
        : "لا توجد تحضيرات محفوظة بعد. اضغطي <strong>＋ تحضير جديد</strong> للبدء.";
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (p) {
      return '' +
        '<article class="prep-item" data-id="' + esc(p.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' + esc(p.prepTitle || "بدون عنوان") + '</div>' +
            '<div class="prep-item-meta">' +
              esc(p.prepGrade || "—") + ' · ' + esc(fmtDate(p.prepDate) || "—") +
            '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-action="print">🖨️ طباعة</button>' +
            '<button type="button" class="btn btn-outline" data-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindPreps() {
    $("#prepForm").addEventListener("submit", submitPrep);

    $("#btnNewPrep").addEventListener("click", function () {
      resetPrepForm();
      openPrepForm();
    });

    $("#btnCancelPrep").addEventListener("click", function () {
      resetPrepForm();
      closePrepForm();
    });

    $("#btnResetPrep").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول؟ (لن يُحذف أي تحضير محفوظ)")) return;
      resetPrepForm();
    });

    $("#prepSearch").addEventListener("input", renderPreps);

    // أزرار الطباعة/التعديل/الحذف داخل القائمة
    $("#prepList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var item = btn.closest(".prep-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-action");

      if (action === "edit") editPrep(id);
      else if (action === "delete") deletePrep(id);
      else if (action === "print") printPrep(id);
    });
  }

  /* ---------------- 5) دفتر الملاحظات ---------------- */

  function getNotes() {
    var list = storageGet(KEYS.notes, []);
    return Array.isArray(list) ? list : [];
  }

  function saveNotes(list) {
    return storageSet(KEYS.notes, list);
  }

  function resetNoteForm() {
    $("#noteForm").reset();
    $("#noteId").value = "";
    $("#noteFormTitle").textContent = "ملاحظة جديدة";
    $("#noteError").classList.add("is-hidden");
  }

  function openNoteForm() {
    $("#noteFormCard").classList.remove("is-hidden");
    $("#noteFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("noteTitle").focus(); }, 300);
  }

  function closeNoteForm() {
    $("#noteFormCard").classList.add("is-hidden");
  }

  function submitNote(e) {
    e.preventDefault();

    var title = document.getElementById("noteTitle").value.trim();
    var body = document.getElementById("noteBody").value.trim();
    var errBox = $("#noteError");

    if (!title || !body) {
      var missing = [];
      if (!title) missing.push("عنوان الملاحظة");
      if (!body) missing.push("نص الملاحظة");
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#noteId").value;
    var list = getNotes();

    if (id) {
      var found = false;
      list = list.map(function (n) {
        if (n.id === id) {
          found = true;
          return Object.assign({}, n, { noteTitle: title, noteBody: body, updatedAt: new Date().toISOString() });
        }
        return n;
      });
      if (!found) { toast("⚠️ لم يتم العثور على الملاحظة المطلوبة"); return; }
      if (saveNotes(list)) toast("✅ تم تعديل الملاحظة");
    } else {
      list.unshift({
        id: uid(),
        noteTitle: title,
        noteBody: body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (saveNotes(list)) toast("✅ حُفظت الملاحظة");
    }

    resetNoteForm();
    closeNoteForm();
    renderNotes();
  }

  function editNote(id) {
    var note = getNotes().filter(function (n) { return n.id === id; })[0];
    if (!note) return;

    resetNoteForm();
    $("#noteId").value = note.id;
    document.getElementById("noteTitle").value = note.noteTitle || "";
    document.getElementById("noteBody").value = note.noteBody || "";
    $("#noteFormTitle").textContent = "تعديل الملاحظة: " + (note.noteTitle || "");
    openNoteForm();
  }

  function deleteNote(id) {
    var note = getNotes().filter(function (n) { return n.id === id; })[0];
    if (!note) return;

    var ok = window.confirm("هل تريدين حذف ملاحظة «" + (note.noteTitle || "بدون عنوان") + "» نهائيًا؟");
    if (!ok) return;

    var list = getNotes().filter(function (n) { return n.id !== id; });
    if (saveNotes(list)) {
      toast("🗑️ تم حذف الملاحظة");
      renderNotes();
    }
  }

  function renderNotes() {
    var list = getNotes();
    var query = ($("#noteSearch").value || "").trim().toLowerCase();

    var filtered = list;
    if (query) {
      filtered = list.filter(function (n) {
        var haystack = ((n.noteTitle || "") + " " + (n.noteBody || "")).toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#noteCount").textContent = list.length;
    var container = $("#noteList");
    var emptyBox = $("#noteEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      emptyBox.innerHTML = query
        ? "لا توجد نتائج مطابقة لـ «" + esc($("#noteSearch").value) + "»."
        : "لا توجد ملاحظات محفوظة بعد. اضغطي <strong>＋ ملاحظة جديدة</strong> للبدء.";
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (n) {
      var full = String(n.noteBody || "");
      var preview = full.replace(/\s+/g, " ").slice(0, 90);
      if (full.length > 90) preview += "…";
      return '' +
        '<article class="prep-item note-item" data-id="' + esc(n.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' + esc(n.noteTitle || "بدون عنوان") + '</div>' +
            '<div class="prep-item-meta note-preview">' + esc(preview) + '</div>' +
            '<div class="prep-item-meta">📅 ' + esc(fmtDate((n.createdAt || "").slice(0, 10)) || "—") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-note-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-note-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindNotes() {
    $("#noteForm").addEventListener("submit", submitNote);

    $("#btnNewNote").addEventListener("click", function () {
      resetNoteForm();
      openNoteForm();
    });

    $("#btnCancelNote").addEventListener("click", function () {
      resetNoteForm();
      closeNoteForm();
    });

    $("#btnResetNote").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول؟ (لن تُحذف أي ملاحظة محفوظة)")) return;
      resetNoteForm();
    });

    $("#noteSearch").addEventListener("input", renderNotes);

    $("#noteList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-note-action]");
      if (!btn) return;
      var item = btn.closest(".note-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-note-action");

      if (action === "edit") editNote(id);
      else if (action === "delete") deleteNote(id);
    });
  }

  /* ---------------- 6) بنك الأنشطة ---------------- */

  var ACTIVITY_CATEGORIES = [
    "أنشطة إنشائية",
    "أنشطة حسابية",
    "استقصاء وحل مشكلات",
    "ألعاب صفية",
    "أنشطة تقويمية",
    "أخرى"
  ];

  var ACTIVITY_FIELDS = [
    { id: "activityTitle",    label: "عنوان النشاط" },
    { id: "activityCategory", label: "التصنيف" },
    { id: "activityGrade",    label: "الصف الدراسي" },
    { id: "activityDuration", label: "زمن التنفيذ" },
    { id: "activityDesc",     label: "وصف النشاط" },
    { id: "activityTools",    label: "الأدوات والمواد" },
    { id: "activityNotes",    label: "ملاحظات التقويم" }
  ];

  function getActivities() {
    var list = storageGet(KEYS.activities, []);
    return Array.isArray(list) ? list : [];
  }

  function saveActivities(list) {
    return storageSet(KEYS.activities, list);
  }

  /** ملء قائمتي التصنيف (النموذج + المرشّح) */
  function fillCategoryOptions() {
    var formSelect = $("#activityCategory");
    var filterSelect = $("#activityFilter");

    formSelect.innerHTML = ACTIVITY_CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");

    filterSelect.innerHTML = '<option value="">الكل</option>' + ACTIVITY_CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");
  }

  function resetActivityForm() {
    $("#activityForm").reset();
    $("#activityId").value = "";
    $("#activityFormTitle").textContent = "نشاط جديد";
    $("#activityError").classList.add("is-hidden");
  }

  function openActivityForm() {
    $("#activityFormCard").classList.remove("is-hidden");
    $("#activityFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("activityTitle").focus(); }, 300);
  }

  function closeActivityForm() {
    $("#activityFormCard").classList.add("is-hidden");
  }

  function submitActivity(e) {
    e.preventDefault();

    var data = {};
    ACTIVITY_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });

    var missing = [];
    if (!data.activityTitle) missing.push("عنوان النشاط");
    if (!data.activityDesc) missing.push("وصف النشاط والتعليمات");

    var errBox = $("#activityError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#activityId").value;
    var list = getActivities();

    if (id) {
      var found = false;
      list = list.map(function (a) {
        if (a.id === id) {
          found = true;
          return Object.assign({}, a, data, { updatedAt: new Date().toISOString() });
        }
        return a;
      });
      if (!found) { toast("⚠️ لم يتم العثور على النشاط المطلوب"); return; }
      if (saveActivities(list)) toast("✅ تم تعديل النشاط");
    } else {
      var activity = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data
      );
      list.unshift(activity);
      if (saveActivities(list)) toast("✅ حُفظ النشاط");
    }

    resetActivityForm();
    closeActivityForm();
    renderActivities();
  }

  function editActivity(id) {
    var act = getActivities().filter(function (a) { return a.id === id; })[0];
    if (!act) return;

    resetActivityForm();
    $("#activityId").value = act.id;
    ACTIVITY_FIELDS.forEach(function (f) {
      if (act[f.id] !== undefined) document.getElementById(f.id).value = act[f.id];
    });
    $("#activityFormTitle").textContent = "تعديل النشاط: " + (act.activityTitle || "");
    openActivityForm();
  }

  function deleteActivity(id) {
    var act = getActivities().filter(function (a) { return a.id === id; })[0];
    if (!act) return;

    var ok = window.confirm("هل تريدين حذف نشاط «" + (act.activityTitle || "بدون عنوان") + "» نهائيًا؟");
    if (!ok) return;

    var list = getActivities().filter(function (a) { return a.id !== id; });
    if (saveActivities(list)) {
      toast("🗑️ تم حذف النشاط");
      renderActivities();
    }
  }

  function renderActivities() {
    var list = getActivities();
    var query = ($("#activitySearch").value || "").trim().toLowerCase();
    var category = $("#activityFilter").value;

    var filtered = list;
    if (category) {
      filtered = filtered.filter(function (a) { return a.activityCategory === category; });
    }
    if (query) {
      filtered = filtered.filter(function (a) {
        var haystack = [
          a.activityTitle, a.activityDesc, a.activityTools,
          a.activityGrade, a.activityCategory
        ].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#activityCount").textContent = list.length;
    var container = $("#activityList");
    var emptyBox = $("#activityEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      if (query || category) {
        emptyBox.textContent = "لا توجد أنشطة مطابقة لخيارات البحث الحالية.";
      } else {
        emptyBox.innerHTML = "لا توجد أنشطة محفوظة بعد. اضغطي <strong>＋ نشاط جديد</strong> للبدء.";
      }
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (a) {
      var preview = String(a.activityDesc || "").replace(/\s+/g, " ").slice(0, 90);
      if ((a.activityDesc || "").length > 90) preview += "…";
      var meta = [];
      if (a.activityCategory) meta.push(esc(a.activityCategory));
      if (a.activityGrade) meta.push(esc(a.activityGrade));
      if (a.activityDuration) meta.push("⏱ " + esc(a.activityDuration));

      return '' +
        '<article class="prep-item activity-item" data-id="' + esc(a.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' +
              (a.activityCategory ? '<span class="chip">' + esc(a.activityCategory) + "</span>" : "") +
              esc(a.activityTitle || "بدون عنوان") +
            '</div>' +
            '<div class="prep-item-meta note-preview">' + esc(preview) + '</div>' +
            '<div class="prep-item-meta">' + meta.join(" · ") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-act-action="print">🖨️ طباعة</button>' +
            '<button type="button" class="btn btn-outline" data-act-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-act-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindActivities() {
    $("#activityForm").addEventListener("submit", submitActivity);

    $("#btnNewActivity").addEventListener("click", function () {
      resetActivityForm();
      openActivityForm();
    });

    $("#btnCancelActivity").addEventListener("click", function () {
      resetActivityForm();
      closeActivityForm();
    });

    $("#btnResetActivity").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول؟ (لن يُحذف أي نشاط محفوظ)")) return;
      resetActivityForm();
    });

    $("#activitySearch").addEventListener("input", renderActivities);
    $("#activityFilter").addEventListener("change", renderActivities);

    $("#activityList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act-action]");
      if (!btn) return;
      var item = btn.closest(".activity-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-act-action");

      if (action === "edit") editActivity(id);
      else if (action === "delete") deleteActivity(id);
      else if (action === "print") printActivity(id);
    });
  }

  /* ---------------- 7) التقويم والاختبارات ---------------- */

  var TEST_TYPES = ["اختبار شهري", "اختبار فصلي", "فرض", "تقويم قصير", "ورقة عمل", "أخرى"];
  var QUESTION_KINDS = ["سؤال مفتوح", "اختيار من متعدد", "صح وخطأ", "مسألة", "أخرى"];

  var TEST_FIELDS = [
    { id: "testTitle",        label: "عنوان الاختبار" },
    { id: "testGrade",        label: "الصف والشعبة" },
    { id: "testType",         label: "نوع التقويم" },
    { id: "testDate",         label: "التاريخ" },
    { id: "testDuration",     label: "زمن الاختبار" },
    { id: "testTotal",        label: "الدرجة الكلية" },
    { id: "testInstructions", label: "تعليمات الاختبار" }
  ];

  function getTests() {
    var list = storageGet(KEYS.tests, []);
    return Array.isArray(list) ? list : [];
  }

  function saveTests(list) {
    return storageSet(KEYS.tests, list);
  }

  function fillTestOptions() {
    var opts = TEST_TYPES.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
    }).join("");
    $("#testType").innerHTML = opts;
    $("#testFilter").innerHTML = '<option value="">الكل</option>' + opts;
  }

  /* ----- محرّر الأسئلة ----- */

  function questionRowHtml(q, index) {
    var qid = (q && q.id) ? q.id : uid();
    var text = (q && q.text) ? q.text : "";
    var kind = (q && q.kind) ? q.kind : QUESTION_KINDS[0];
    var degree = (q && typeof q.degree === "number" && isFinite(q.degree)) ? q.degree : 1;

    return '' +
      '<div class="q-row" data-qid="' + esc(qid) + '">' +
        '<span class="q-num">' + (index + 1) + '</span>' +
        '<textarea class="q-text" rows="2" placeholder="نص السؤال…">' + esc(text) + '</textarea>' +
        '<select class="q-kind">' + QUESTION_KINDS.map(function (k) {
          return '<option value="' + esc(k) + '"' + (k === kind ? " selected" : "") + '>' + esc(k) + '</option>';
        }).join("") + '</select>' +
        '<input type="number" class="q-degree" min="0" step="0.5" value="' + degree + '" title="درجة السؤال" aria-label="درجة السؤال">' +
        '<button type="button" class="btn btn-danger q-del" data-qdel="' + esc(qid) + '" title="حذف السؤال">🗑️</button>' +
      '</div>';
  }

  function renderQuestions(list) {
    $("#questionRows").innerHTML = (list || []).map(questionRowHtml).join("");
    var n = (list || []).length;
    $("#questionsEmpty").classList.toggle("is-hidden", n > 0);
    $("#questionCount").textContent = n;
    updateTotal();
  }

  function readQuestions() {
    return $all("#questionRows .q-row").map(function (row) {
      var degree = parseFloat(row.querySelector(".q-degree").value);
      return {
        id: row.getAttribute("data-qid"),
        text: row.querySelector(".q-text").value.trim(),
        kind: row.querySelector(".q-kind").value,
        degree: isFinite(degree) ? degree : 0
      };
    });
  }

  function updateTotal() {
    var sum = readQuestions().reduce(function (acc, q) { return acc + q.degree; }, 0);
    sum = Math.round(sum * 100) / 100;
    $("#testTotal").value = sum > 0 ? String(sum) : "";
  }

  /** صياغة الدرجة بالعربية */
  function degreeLabel(d) {
    if (d === 1) return "(درجة واحدة)";
    if (d === 2) return "(درجتان)";
    if (d >= 3 && d <= 10) return "(" + d + " درجات)";
    return "(" + d + " درجة)";
  }

  /* ----- النموذج والقائمة ----- */

  function resetTestForm() {
    $("#testForm").reset();
    $("#testId").value = "";
    $("#testDate").value = todayISO();
    $("#testFormTitle").textContent = "اختبار جديد";
    $("#testError").classList.add("is-hidden");
    renderQuestions([]);
  }

  function openTestForm() {
    $("#testFormCard").classList.remove("is-hidden");
    $("#testFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("testTitle").focus(); }, 300);
  }

  function closeTestForm() {
    $("#testFormCard").classList.add("is-hidden");
  }

  function submitTest(e) {
    e.preventDefault();

    var data = {};
    TEST_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });

    var questions = readQuestions().filter(function (q) { return q.text.length > 0; });

    var missing = [];
    if (!data.testTitle) missing.push("عنوان الاختبار / التقويم");
    if (!data.testGrade) missing.push("الصف والشعبة");
    if (questions.length === 0) missing.push("إضافة سؤال واحد على الأقل");

    var errBox = $("#testError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    // الدرجة الكلية تُحسب دائمًا من درجات الأسئلة
    data.testTotal = String(questions.reduce(function (acc, q) { return acc + q.degree; }, 0));

    var id = $("#testId").value;
    var list = getTests();

    if (id) {
      var found = false;
      list = list.map(function (t) {
        if (t.id === id) {
          found = true;
          return Object.assign({}, t, data, { testQuestions: questions, updatedAt: new Date().toISOString() });
        }
        return t;
      });
      if (!found) { toast("⚠️ لم يتم العثور على الاختبار المطلوب"); return; }
      if (saveTests(list)) toast("✅ تم تعديل الاختبار");
    } else {
      var test = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data,
        { testQuestions: questions }
      );
      list.unshift(test);
      if (saveTests(list)) toast("✅ حُفظ الاختبار");
    }

    resetTestForm();
    closeTestForm();
    renderTests();
  }

  function editTest(id) {
    var t = getTests().filter(function (x) { return x.id === id; })[0];
    if (!t) return;

    resetTestForm();
    $("#testId").value = t.id;
    TEST_FIELDS.forEach(function (f) {
      if (t[f.id] !== undefined) document.getElementById(f.id).value = t[f.id];
    });
    renderQuestions(Array.isArray(t.testQuestions) ? t.testQuestions : []);
    $("#testFormTitle").textContent = "تعديل الاختبار: " + (t.testTitle || "");
    openTestForm();
  }

  function deleteTest(id) {
    var t = getTests().filter(function (x) { return x.id === id; })[0];
    if (!t) return;

    var ok = window.confirm("هل تريدين حذف اختبار «" + (t.testTitle || "بدون عنوان") + "» نهائيًا؟");
    if (!ok) return;

    var list = getTests().filter(function (x) { return x.id !== id; });
    if (saveTests(list)) {
      toast("🗑️ تم حذف الاختبار");
      renderTests();
    }
  }

  function renderTests() {
    var list = getTests();
    var query = ($("#testSearch").value || "").trim().toLowerCase();
    var type = $("#testFilter").value;

    var filtered = list;
    if (type) filtered = filtered.filter(function (t) { return t.testType === type; });
    if (query) {
      filtered = filtered.filter(function (t) {
        var haystack = [t.testTitle, t.testGrade, t.testType, t.testInstructions].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#testCount").textContent = list.length;
    var container = $("#testList");
    var emptyBox = $("#testEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      if (query || type) {
        emptyBox.textContent = "لا توجد اختبارات مطابقة لخيارات البحث الحالية.";
      } else {
        emptyBox.innerHTML = "لا توجد اختبارات محفوظة بعد. اضغطي <strong>＋ اختبار / تقويم جديد</strong> للبدء.";
      }
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (t) {
      var qCount = Array.isArray(t.testQuestions) ? t.testQuestions.length : 0;
      var meta = [];
      if (t.testGrade) meta.push(esc(t.testGrade));
      if (t.testDate) meta.push(esc(fmtDate(t.testDate)));
      meta.push(qCount + " سؤال" + (t.testTotal ? " · الدرجة الكلية " + esc(t.testTotal) : ""));

      return '' +
        '<article class="prep-item test-item" data-id="' + esc(t.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' +
              (t.testType ? '<span class="chip">' + esc(t.testType) + "</span>" : "") +
              esc(t.testTitle || "بدون عنوان") +
            '</div>' +
            '<div class="prep-item-meta">' + meta.join(" · ") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-test-action="print">🖨️ طباعة</button>' +
            '<button type="button" class="btn btn-outline" data-test-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-test-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindTests() {
    $("#testForm").addEventListener("submit", submitTest);

    $("#btnNewTest").addEventListener("click", function () {
      resetTestForm();
      openTestForm();
    });

    $("#btnCancelTest").addEventListener("click", function () {
      resetTestForm();
      closeTestForm();
    });

    $("#btnResetTest").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول والأسئلة؟ (لن يُحذف أي اختبار محفوظ)")) return;
      resetTestForm();
    });

    $("#btnAddQuestion").addEventListener("click", function () {
      var list = readQuestions();
      list.push({ id: uid(), text: "", kind: QUESTION_KINDS[0], degree: 1 });
      renderQuestions(list);
      var rows = $all("#questionRows .q-row");
      var last = rows[rows.length - 1];
      if (last) last.querySelector(".q-text").focus();
    });

    // حذف سؤال + تحديث الدرجة الكلية عند أي تغيير
    $("#questionRows").addEventListener("click", function (e) {
      var del = e.target.closest("[data-qdel]");
      if (!del) return;
      var row = del.closest(".q-row");
      if (row) row.remove();
      renderQuestions(readQuestions());
    });

    $("#questionRows").addEventListener("input", updateTotal);
    $("#questionRows").addEventListener("change", updateTotal);

    $("#testSearch").addEventListener("input", renderTests);
    $("#testFilter").addEventListener("change", renderTests);

    $("#testList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-test-action]");
      if (!btn) return;
      var item = btn.closest(".test-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-test-action");

      if (action === "edit") editTest(id);
      else if (action === "delete") deleteTest(id);
      else if (action === "print") printTest(id);
    });
  }

  /* ---------------- 8) الخطط السنوية والشهرية والأسبوعية ---------------- */

  var PLAN_TYPES = ["أسبوعية", "شهرية", "سنوية"];

  // بنود التعبئة التلقائية حسب نوع الخطة (حصة واحدة يوميًا، 5 أيام أسبوعيًا)
  var PLAN_AUTO = {
    "أسبوعية": ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"],
    "شهرية": ["الأسبوع الأول", "الأسبوع الثاني", "الأسبوع الثالث", "الأسبوع الرابع", "الأسبوع الخامس"],
    "سنوية": ["سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير",
               "فبراير", "مارس", "أبريل", "مايو", "يونيو"]
  };

  var PLAN_HINTS = {
    "أسبوعية": "خطة الأسبوع = 5 حصص: حصة واحدة كل يوم من الأحد إلى الخميس.",
    "شهرية": "خطة الشهر = أسابيعه، وكل أسبوع يحتوي 5 حصص (حصة يوميًا).",
    "سنوية": "الخطة السنوية تغطي أشهر السنة الدراسية، وكل شهر يعادل نحو 20 حصة (5 أسابيع × 5 حصص)."
  };

  var PLAN_FIELDS = [
    { id: "planType",    label: "نوع الخطة" },
    { id: "planTitle",   label: "عنوان الخطة" },
    { id: "planGrade",   label: "الصف والشعبة" },
    { id: "planPeriod",  label: "الفترة" },
    { id: "planNotes",   label: "ملاحظات الخطة" }
  ];

  function getPlans() {
    var list = storageGet(KEYS.plans, []);
    return Array.isArray(list) ? list : [];
  }

  function savePlans(list) {
    return storageSet(KEYS.plans, list);
  }

  function fillPlanTypeOptions() {
    $("#planType").innerHTML = PLAN_TYPES.map(function (t) {
      return '<option value="' + esc(t) + '">خطة ' + esc(t) + "</option>";
    }).join("");
    $("#planFilter").innerHTML = '<option value="">الكل</option>' + PLAN_TYPES.map(function (t) {
      return '<option value="' + esc(t) + '">خطة ' + esc(t) + "</option>";
    }).join("");
  }

  function updatePlanHint() {
    var type = $("#planType").value || PLAN_TYPES[0];
    $("#planAutoHint").textContent = PLAN_HINTS[type] || "";
  }

  /* ----- محرّر بنود الخطة ----- */

  function planRowHtml(row, index) {
    var rid = (row && row.id) ? row.id : uid();
    return '' +
      '<div class="q-row plan-row" data-rid="' + esc(rid) + '">' +
        '<input type="text" class="plan-label" value="' + esc((row && row.label) || "") + '" placeholder="اليوم / الفترة" aria-label="اليوم أو الفترة">' +
        '<input type="text" class="plan-topic" value="' + esc((row && row.topic) || "") + '" placeholder="الموضوع / الدرس" aria-label="الموضوع أو الدرس">' +
        '<input type="text" class="plan-note" value="' + esc((row && row.note) || "") + '" placeholder="ملاحظات" aria-label="ملاحظات">' +
        '<button type="button" class="btn btn-danger q-del" data-rdel="' + esc(rid) + '" title="حذف البند">🗑️</button>' +
      '</div>';
  }

  function renderPlanRows(list) {
    $("#planRows").innerHTML = (list || []).map(planRowHtml).join("");
    var n = (list || []).length;
    $("#planRowsEmpty").classList.toggle("is-hidden", n > 0);
    $("#planRowCount").textContent = n;
  }

  function readPlanRows() {
    return $all("#planRows .plan-row").map(function (row) {
      return {
        id: row.getAttribute("data-rid"),
        label: row.querySelector(".plan-label").value.trim(),
        topic: row.querySelector(".plan-topic").value.trim(),
        note: row.querySelector(".plan-note").value.trim()
      };
    });
  }

  /** تعبئة البنود تلقائيًا حسب نوع الخطة (مع الحفاظ على ما كُتب بنفس البند) */
  function autoFillPlanRows() {
    var type = $("#planType").value || PLAN_TYPES[0];
    var labels = PLAN_AUTO[type] || [];
    var existing = readPlanRows();

    var rows = labels.map(function (label) {
      var match = existing.filter(function (r) { return r.label === label; })[0];
      return {
        id: match ? match.id : uid(),
        label: label,
        topic: match ? match.topic : "",
        note: match ? match.note : ""
      };
    });

    renderPlanRows(rows);
    toast("🗓️ تم تعبئة " + rows.length + " بنود لخطة " + type);
  }

  /* ----- النموذج والقائمة ----- */

  function resetPlanForm() {
    $("#planForm").reset();
    $("#planId").value = "";
    $("#planFormTitle").textContent = "خطة جديدة";
    $("#planError").classList.add("is-hidden");
    renderPlanRows([]);
    updatePlanHint();
  }

  function openPlanForm() {
    $("#planFormCard").classList.remove("is-hidden");
    $("#planFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("planTitle").focus(); }, 300);
  }

  function closePlanForm() {
    $("#planFormCard").classList.add("is-hidden");
  }

  function submitPlan(e) {
    e.preventDefault();

    var data = {};
    PLAN_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });

    var rows = readPlanRows().filter(function (r) {
      return r.label.length > 0 || r.topic.length > 0 || r.note.length > 0;
    });

    var missing = [];
    if (!data.planTitle) missing.push("عنوان الخطة");
    if (!data.planGrade) missing.push("الصف والشعبة");
    if (rows.length === 0) missing.push("إضافة بند واحد على الأقل");

    var errBox = $("#planError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#planId").value;
    var list = getPlans();

    if (id) {
      var found = false;
      list = list.map(function (p) {
        if (p.id === id) {
          found = true;
          return Object.assign({}, p, data, { planRows: rows, updatedAt: new Date().toISOString() });
        }
        return p;
      });
      if (!found) { toast("⚠️ لم يتم العثور على الخطة المطلوبة"); return; }
      if (savePlans(list)) toast("✅ تم تعديل الخطة");
    } else {
      var plan = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data,
        { planRows: rows }
      );
      list.unshift(plan);
      if (savePlans(list)) toast("✅ حُفظت الخطة");
    }

    resetPlanForm();
    closePlanForm();
    renderPlans();
  }

  function editPlan(id) {
    var p = getPlans().filter(function (x) { return x.id === id; })[0];
    if (!p) return;

    resetPlanForm();
    $("#planId").value = p.id;
    PLAN_FIELDS.forEach(function (f) {
      if (p[f.id] !== undefined) document.getElementById(f.id).value = p[f.id];
    });
    renderPlanRows(Array.isArray(p.planRows) ? p.planRows : []);
    updatePlanHint();
    $("#planFormTitle").textContent = "تعديل الخطة: " + (p.planTitle || "");
    openPlanForm();
  }

  function deletePlan(id) {
    var p = getPlans().filter(function (x) { return x.id === id; })[0];
    if (!p) return;

    var ok = window.confirm("هل تريدين حذف خطة «" + (p.planTitle || "بدون عنوان") + "» نهائيًا؟");
    if (!ok) return;

    var list = getPlans().filter(function (x) { return x.id !== id; });
    if (savePlans(list)) {
      toast("🗑️ تم حذف الخطة");
      renderPlans();
    }
  }

  function renderPlans() {
    var list = getPlans();
    var query = ($("#planSearch").value || "").trim().toLowerCase();
    var type = $("#planFilter").value;

    var filtered = list;
    if (type) filtered = filtered.filter(function (p) { return p.planType === type; });
    if (query) {
      filtered = filtered.filter(function (p) {
        var rowText = (p.planRows || []).map(function (r) { return r.label + " " + r.topic; }).join(" ");
        var haystack = [p.planTitle, p.planGrade, p.planType, p.planPeriod, rowText].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#planCount").textContent = list.length;
    var container = $("#planList");
    var emptyBox = $("#planEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      if (query || type) {
        emptyBox.textContent = "لا توجد خطط مطابقة لخيارات البحث الحالية.";
      } else {
        emptyBox.innerHTML = "لا توجد خطط محفوظة بعد. اضغطي <strong>＋ خطة جديدة</strong> للبدء.";
      }
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (p) {
      var rows = Array.isArray(p.planRows) ? p.planRows.length : 0;
      var meta = [];
      if (p.planGrade) meta.push(esc(p.planGrade));
      if (p.planPeriod) meta.push(esc(p.planPeriod));
      meta.push(rows + " بند");

      return '' +
        '<article class="prep-item plan-item" data-id="' + esc(p.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' +
              (p.planType ? '<span class="chip">خطة ' + esc(p.planType) + "</span>" : "") +
              esc(p.planTitle || "بدون عنوان") +
            '</div>' +
            '<div class="prep-item-meta">' + meta.join(" · ") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-plan-action="print">🖨️ طباعة</button>' +
            '<button type="button" class="btn btn-outline" data-plan-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-plan-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindPlans() {
    $("#planForm").addEventListener("submit", submitPlan);

    $("#btnNewPlan").addEventListener("click", function () {
      resetPlanForm();
      openPlanForm();
    });

    $("#btnCancelPlan").addEventListener("click", function () {
      resetPlanForm();
      closePlanForm();
    });

    $("#btnResetPlan").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول والبنود؟ (لن تُحذف أي خطة محفوظة)")) return;
      resetPlanForm();
    });

    $("#planType").addEventListener("change", updatePlanHint);

    $("#btnAutoFillPlan").addEventListener("click", autoFillPlanRows);

    $("#btnAddPlanRow").addEventListener("click", function () {
      var rows = readPlanRows();
      rows.push({ id: uid(), label: "", topic: "", note: "" });
      renderPlanRows(rows);
      var items = $all("#planRows .plan-row");
      var last = items[items.length - 1];
      if (last) last.querySelector(".plan-label").focus();
    });

    $("#planRows").addEventListener("click", function (e) {
      var del = e.target.closest("[data-rdel]");
      if (!del) return;
      var row = del.closest(".plan-row");
      if (row) row.remove();
      renderPlanRows(readPlanRows());
    });

    $("#planSearch").addEventListener("input", renderPlans);
    $("#planFilter").addEventListener("change", renderPlans);

    $("#planList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-plan-action]");
      if (!btn) return;
      var item = btn.closest(".plan-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-plan-action");

      if (action === "edit") editPlan(id);
      else if (action === "delete") deletePlan(id);
      else if (action === "print") printPlan(id);
    });
  }

  /* ---------------- 9) طباعة الخطة (A4) ---------------- */

  function buildPlanPrintDoc(p) {
    var basic = getBasic();
    var rows = Array.isArray(p.planRows) ? p.planRows : [];

    var info = '<div><strong>الصف والشعبة:</strong> ' + esc(p.planGrade || "") + '</div>';
    if (p.planType) info += '<div><strong>نوع الخطة:</strong> خطة ' + esc(p.planType) + '</div>';
    if (p.planPeriod) info += '<div><strong>الفترة:</strong> ' + esc(p.planPeriod) + '</div>';
    info += '<div><strong>عدد البنود:</strong> ' + rows.length + '</div>';
    if (p.planType === "أسبوعية") info += '<div><strong>عدد الحصص:</strong> ' + rows.length + ' (حصة واحدة يوميًا)</div>';

    var body = rows.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.label || "") + '</td>' +
        '<td>' + esc(r.topic || "") + '</td>' +
        '<td>' + esc(r.note || "") + '</td>' +
      '</tr>';
    }).join("");

    var notes = (p.planNotes || "").trim();

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>' + esc(p.planTitle || "خطة") + '</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' + info + '</div>' +

        '<section class="print-block">' +
          '<h2>بنود الخطة</h2>' +
          '<table class="print-table">' +
            '<thead><tr><th style="width:22%">اليوم / الفترة</th><th style="width:46%">الموضوع / الدرس</th><th>ملاحظات</th></tr></thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>' +
        '</section>' +

        (notes
          ? '<section class="print-block"><h2>ملاحظات عامة</h2><div class="print-body">' + esc(notes) + '</div></section>'
          : "") +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function printPlan(id) {
    var p = getPlans().filter(function (x) { return x.id === id; })[0];
    if (!p) { toast("⚠️ لم يتم العثور على الخطة"); return; }

    $("#printArea").innerHTML = buildPlanPrintDoc(p);
    document.body.classList.add("print-mode");
    window.print();
  }

  /* ---------------- 10) طباعة الاختبار (A4) ---------------- */

  function buildTestPrintDoc(t) {
    var basic = getBasic();
    var questions = Array.isArray(t.testQuestions) ? t.testQuestions : [];

    var info = '<div><strong>الصف والشعبة:</strong> ' + esc(t.testGrade || "") + '</div>';
    if (t.testType) info += '<div><strong>نوع التقويم:</strong> ' + esc(t.testType) + '</div>';
    if (t.testDate) info += '<div><strong>التاريخ:</strong> ' + esc(fmtDate(t.testDate)) + '</div>';
    if (t.testDuration) info += '<div><strong>زمن الاختبار:</strong> ' + esc(t.testDuration) + '</div>';
    info += '<div><strong>الدرجة الكلية:</strong> ' + esc(t.testTotal || "—") + '</div>';
    info += '<div><strong>اسم التلميذ/ة:</strong> ..............................</div>';

    var qs = questions.map(function (q, i) {
      return '' +
        '<div class="print-q">' +
          '<span class="q-badge">' + (i + 1) + ')</span>' +
          '<span class="q-text">' + esc(q.text || "") +
            (q.kind && q.kind !== "سؤال مفتوح" ? ' <span class="q-kind">(' + esc(q.kind) + ')</span>' : "") +
          '</span>' +
          '<span class="q-degree">' + degreeLabel(q.degree) + '</span>' +
        '</div>';
    }).join("");

    var instr = (t.testInstructions || "").trim();

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>' + esc(t.testTitle || "ورقة اختبار") + '</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' + info + '</div>' +

        (instr
          ? '<section class="print-block"><h2>تعليمات</h2><div class="print-body">' + esc(instr) + '</div></section>'
          : "") +

        '<section class="print-block">' +
          '<h2>الأسئلة</h2>' +
          '<div class="print-questions">' + qs + '</div>' +
          '<div class="print-total">الدرجة الكلية: ' + esc(t.testTotal || "—") + '</div>' +
        '</section>' +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function printTest(id) {
    var t = getTests().filter(function (x) { return x.id === id; })[0];
    if (!t) { toast("⚠️ لم يتم العثور على الاختبار"); return; }

    $("#printArea").innerHTML = buildTestPrintDoc(t);
    document.body.classList.add("print-mode");
    window.print();
  }

  /* ---------------- 11) النسخ الاحتياطي (تصدير / استيراد) ---------------- */

  function setBackupStatus(text, kind) {
    var el = $("#backupStatus");
    el.textContent = text;
    el.className = "tiny" + (kind ? " " + kind : "");
  }

  function exportBackup() {
    try {
      var data = {
        app: "كراسة المعلم الليبي الرقمية – رياضيات المرحلة الإعدادية",
        version: 1,
        exportedAt: new Date().toISOString(),
        basic: getBasic(),
        preps: getPreps(),
        notes: getNotes(),
        activities: getActivities(),
        tests: getTests(),
        plans: getPlans(),
        students: getStudents(),
        diffs: getDiffs()
      };

      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");

      link.href = url;
      link.download = "kmt-backup-" + todayISO() + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

      setBackupStatus(
        "✅ تم تنزيل النسخة الاحتياطية (" + data.preps.length + " تحضيرًا، " +
        data.notes.length + " ملاحظة، " + data.activities.length + " نشاط، " +
        data.tests.length + " اختبار، " + data.plans.length + " خطة، " +
        data.students.length + " تلميذ، " + data.diffs.length + " ملف فروق). احتفظي بالملف في مكان آمن.",
        "ok"
      );
      toast("⬇️ تم تنزيل النسخة الاحتياطية");
    } catch (err) {
      console.error(err);
      setBackupStatus("⚠️ تعذّر إنشاء النسخة الاحتياطية: " + err.message, "err");
    }
  }

  /** تنظيف التحضيرات القادمة من ملف خارجي */
  function sanitizePreps(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (p) { return p && typeof p === "object"; }).map(function (p) {
      var out = { id: typeof p.id === "string" && p.id ? p.id : uid() };
      PREP_FIELDS.forEach(function (f) {
        out[f.id] = typeof p[f.id] === "string" ? p[f.id] : "";
      });
      out.createdAt = typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString();
      out.updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : out.createdAt;
      return out;
    });
  }

  function sanitizeNotes(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (n) { return n && typeof n === "object"; }).map(function (n) {
      return {
        id: typeof n.id === "string" && n.id ? n.id : uid(),
        noteTitle: typeof n.noteTitle === "string" ? n.noteTitle : "",
        noteBody: typeof n.noteBody === "string" ? n.noteBody : "",
        createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
        updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : (typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString())
      };
    });
  }

  function sanitizeActivities(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (a) { return a && typeof a === "object"; }).map(function (a) {
      var out = { id: typeof a.id === "string" && a.id ? a.id : uid() };
      ACTIVITY_FIELDS.forEach(function (f) {
        out[f.id] = typeof a[f.id] === "string" ? a[f.id] : "";
      });
      out.createdAt = typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString();
      out.updatedAt = typeof a.updatedAt === "string" ? a.updatedAt : out.createdAt;
      return out;
    });
  }

  function sanitizeTests(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (t) { return t && typeof t === "object"; }).map(function (t) {
      var out = { id: typeof t.id === "string" && t.id ? t.id : uid() };
      TEST_FIELDS.forEach(function (f) {
        out[f.id] = typeof t[f.id] === "string" ? t[f.id] : "";
      });
      out.testQuestions = Array.isArray(t.testQuestions)
        ? t.testQuestions.filter(function (q) { return q && typeof q === "object"; }).map(function (q) {
            var degree = typeof q.degree === "number" && isFinite(q.degree) ? q.degree : 0;
            return {
              id: typeof q.id === "string" && q.id ? q.id : uid(),
              text: typeof q.text === "string" ? q.text : "",
              kind: typeof q.kind === "string" ? q.kind : QUESTION_KINDS[0],
              degree: degree
            };
          })
        : [];
      out.createdAt = typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString();
      out.updatedAt = typeof t.updatedAt === "string" ? t.updatedAt : out.createdAt;
      return out;
    });
  }

  function sanitizePlans(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (p) { return p && typeof p === "object"; }).map(function (p) {
      var out = { id: typeof p.id === "string" && p.id ? p.id : uid() };
      PLAN_FIELDS.forEach(function (f) {
        out[f.id] = typeof p[f.id] === "string" ? p[f.id] : "";
      });
      out.planRows = Array.isArray(p.planRows)
        ? p.planRows.filter(function (r) { return r && typeof r === "object"; }).map(function (r) {
            return {
              id: typeof r.id === "string" && r.id ? r.id : uid(),
              label: typeof r.label === "string" ? r.label : "",
              topic: typeof r.topic === "string" ? r.topic : "",
              note: typeof r.note === "string" ? r.note : ""
            };
          })
        : [];
      out.createdAt = typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString();
      out.updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : out.createdAt;
      return out;
    });
  }

  function sanitizeStudents(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (s) { return s && typeof s === "object"; }).map(function (s) {
      var out = { id: typeof s.id === "string" && s.id ? s.id : uid() };
      STUDENT_FIELDS.forEach(function (f) {
        out[f.id] = typeof s[f.id] === "string" ? s[f.id] : "";
      });

      out.grades = Array.isArray(s.grades)
        ? s.grades.filter(function (g) { return g && typeof g === "object"; }).map(function (g) {
            var deg = parseFloat(g.degree);
            var mx = parseFloat(g.max);
            return {
              id: typeof g.id === "string" && g.id ? g.id : uid(),
              exam: typeof g.exam === "string" ? g.exam : "",
              degree: isFinite(deg) && deg >= 0 ? deg : 0,
              max: isFinite(mx) && mx > 0 ? mx : 20,
              date: typeof g.date === "string" ? g.date : todayISO()
            };
          })
        : [];

      out.attendance = Array.isArray(s.attendance)
        ? s.attendance.filter(function (r) { return r && typeof r === "object"; }).map(function (r) {
            var status = typeof r.status === "string" ? r.status : "حاضر";
            if (["حاضر", "غائب", "متأخر", "مستأذن"].indexOf(status) === -1) status = "حاضر";
            return {
              id: typeof r.id === "string" && r.id ? r.id : uid(),
              date: typeof r.date === "string" ? r.date : todayISO(),
              status: status
            };
          })
        : [];

      out.createdAt = typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString();
      out.updatedAt = typeof s.updatedAt === "string" ? s.updatedAt : out.createdAt;
      return out;
    });
  }

  function sanitizeDiffs(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (d) { return d && typeof d === "object"; }).map(function (d) {
      var out = { id: typeof d.id === "string" && d.id ? d.id : uid() };
      DIFF_FIELDS.forEach(function (f) {
        out[f.id] = typeof d[f.id] === "string" ? d[f.id] : "";
      });
      if (["متقدم", "ضمن المستوى", "يحتاج دعمًا"].indexOf(out.diffLevel) === -1) out.diffLevel = "ضمن المستوى";
      out.createdAt = typeof d.createdAt === "string" ? d.createdAt : new Date().toISOString();
      out.updatedAt = typeof d.updatedAt === "string" ? d.updatedAt : out.createdAt;
      return out;
    });
  }

  function importBackup(file) {
    if (!file) return;

    var reader = new FileReader();

    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (err) {
        setBackupStatus("⚠️ الملف غير صالح: لا يمكن قراءته كملف نسخة احتياطية.", "err");
        return;
      }

      if (!data || typeof data !== "object" ||
          (!Array.isArray(data.preps) && !Array.isArray(data.notes) &&
           !Array.isArray(data.activities) && !Array.isArray(data.tests) &&
           !Array.isArray(data.plans) && !Array.isArray(data.students) &&
           !Array.isArray(data.diffs))) {
        setBackupStatus("⚠️ الملف لا يشبه نسخة احتياطية صادرة من هذا التطبيق.", "err");
        return;
      }

      var newPreps = sanitizePreps(data.preps);
      var newNotes = sanitizeNotes(data.notes);
      var newActivities = sanitizeActivities(data.activities);
      var newTests = sanitizeTests(data.tests);
      var newPlans = sanitizePlans(data.plans);
      var newStudents = sanitizeStudents(data.students);
      var newDiffs = sanitizeDiffs(data.diffs);
      var newBasic = (data.basic && typeof data.basic === "object") ? data.basic : null;

      var ok = window.confirm(
        "سيتم استبدال جميع بياناتك الحالية بمحتوى الملف:\n" +
        "• تحضيرات: " + newPreps.length + "\n" +
        "• ملاحظات: " + newNotes.length + "\n" +
        "• أنشطة: " + newActivities.length + "\n" +
        "• اختبارات: " + newTests.length + "\n" +
        "• خطط: " + newPlans.length + "\n" +
        "• تلاميذ: " + newStudents.length + "\n" +
        "• فروق فردية: " + newDiffs.length + "\n\n" +
        "هل تريدين المتابعة؟"
      );

      if (!ok) {
        setBackupStatus("تم إلغاء الاستيراد.", null);
        return;
      }

      var success = true;
      success = savePreps(newPreps) && success;
      success = saveNotes(newNotes) && success;
      success = saveActivities(newActivities) && success;
      success = saveTests(newTests) && success;
      success = savePlans(newPlans) && success;
      success = saveStudents(newStudents) && success;
      success = saveDiffs(newDiffs) && success;
      if (newBasic) success = storageSet(KEYS.basic, newBasic) && success;

      if (!success) return; // رسالة الخطأ تظهر من storageSet

      if (newBasic) loadBasic();
      resetPrepForm();
      renderPreps();
      renderNotes();
      renderActivities();
      renderTests();
      renderPlans();
      panelStudentId = null;
      renderStudentPanel();
      renderStudents();
      renderDiffs();

      setBackupStatus(
        "✅ تم الاستيراد بنجاح: " + newPreps.length + " تحضيرًا و" +
        newNotes.length + " ملاحظة و" + newActivities.length + " نشاط و" +
        newTests.length + " اختبار و" + newPlans.length + " خطة و" +
        newStudents.length + " تلميذ و" + newDiffs.length + " ملف فروق.",
        "ok"
      );
      toast("⬆️ تم استيراد النسخة الاحتياطية");
    };

    reader.onerror = function () {
      setBackupStatus("⚠️ تعذّرت قراءة الملف.", "err");
    };

    reader.readAsText(file, "utf-8");
  }

  function bindBackup() {
    $("#btnExport").addEventListener("click", exportBackup);
    $("#importFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      importBackup(file);
      e.target.value = ""; // للسماح باختيار الملف نفسه مرة أخرى
    });
  }

  /* ---------------- 12) طباعة النشاط ---------------- */

  function buildActivityPrintDoc(act) {
    var basic = getBasic();

    function block(label, text) {
      var body = (text || "").trim();
      return '' +
        '<section class="print-block">' +
          '<h2>' + esc(label) + '</h2>' +
          '<div class="print-body">' + (body ? esc(body) : "&nbsp;") + '</div>' +
        '</section>';
    }

    var info = '<div><strong>عنوان النشاط:</strong> ' + esc(act.activityTitle || "") + '</div>';
    if (act.activityCategory) info += '<div><strong>التصنيف:</strong> ' + esc(act.activityCategory) + '</div>';
    if (act.activityGrade) info += '<div><strong>الصف الدراسي:</strong> ' + esc(act.activityGrade) + '</div>';
    if (act.activityDuration) info += '<div><strong>زمن التنفيذ:</strong> ' + esc(act.activityDuration) + '</div>';

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>نشاط رياضي</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' + info + '</div>' +

        block("وصف النشاط والتعليمات", act.activityDesc) +
        block("الأدوات والمواد المطلوبة", act.activityTools) +
        block("ملاحظات التقويم", act.activityNotes) +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function printActivity(id) {
    var act = getActivities().filter(function (a) { return a.id === id; })[0];
    if (!act) { toast("⚠️ لم يتم العثور على النشاط"); return; }

    $("#printArea").innerHTML = buildActivityPrintDoc(act);
    document.body.classList.add("print-mode");
    window.print();
  }

  /* ---------------- 13) الطباعة بتحضير الدرس (A4) ---------------- */

  /** بناء وثيقة الطباعة من بيانات التحضير */
  function buildPrintDoc(prep) {
    var basic = getBasic();

    function block(label, text, extraClass) {
      var body = (text || "").trim();
      return '' +
        '<section class="print-block ' + (extraClass || "") + '">' +
          '<h2>' + esc(label) + '</h2>' +
          '<div class="print-body">' + (body ? esc(body) : "&nbsp;") + '</div>' +
        '</section>';
    }

    // خطوات الدرس: كل سطر في سطر مستقل
    var stepsHtml = "";
    var steps = (prep.prepSteps || "").split("\n").map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });

    if (steps.length) {
      stepsHtml = steps.map(function (s) { return "<div>" + esc(s) + "</div>"; }).join("");
    } else {
      stepsHtml = "<div>&nbsp;</div>";
    }

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>تحضير درس يومي</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' +
          '<div><strong>الصف والشعبة:</strong> ' + esc(prep.prepGrade || "") + '</div>' +
          '<div><strong>التاريخ:</strong> ' + esc(fmtDate(prep.prepDate)) + '</div>' +
          '<div><strong>عنوان الدرس:</strong> ' + esc(prep.prepTitle || "") + '</div>' +
          '<div><strong>السنة الدراسية:</strong> ' + esc(basic.bdYear || "") + '</div>' +
        '</div>' +

        block("الأهداف المعرفية", prep.prepCognitive) +
        block("الأهداف المهارية", prep.prepSkill) +
        block("الأهداف الوجدانية", prep.prepAffective) +
        block("التمهيد", prep.prepIntro) +
        block("الوسائل", prep.prepTools) +
        block("استراتيجيات التدريس", prep.prepStrategies) +

        '<section class="print-block">' +
          '<h2>خطوات الدرس</h2>' +
          '<div class="print-steps">' + stepsHtml + '</div>' +
        '</section>' +

        block("التقويم", prep.prepAssessment) +
        block("الواجب المنزلي", prep.prepHomework) +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function printPrep(id) {
    var prep = getPreps().filter(function (p) { return p.id === id; })[0];
    if (!prep) { toast("⚠️ لم يتم العثور على التحضير"); return; }

    $("#printArea").innerHTML = buildPrintDoc(prep);
    document.body.classList.add("print-mode");
    window.print();
  }

  // إزالة وضع الطباعة بعد فتح نافذة الطباعة
  window.addEventListener("afterprint", function () {
    document.body.classList.remove("print-mode");
    $("#printArea").innerHTML = "";
  });

  /* ---------------- 14) متابعة التلاميذ ---------------- */

  var STUDENT_FIELDS = [
    { id: "studentName",   label: "اسم التلميذ" },
    { id: "studentSerial", label: "رقم القيد" },
    { id: "studentGrade",  label: "الصف والشعبة" },
    { id: "studentNote",   label: "ملاحظة سريعة" }
  ];

  var panelStudentId = null; // التلميذ المفتوح في لوحة الدرجات والحضور

  function getStudents() {
    var list = storageGet(KEYS.students, []);
    return Array.isArray(list) ? list : [];
  }

  function saveStudents(list) {
    return storageSet(KEYS.students, list);
  }

  function findStudent(id) {
    if (!id) return null;
    var found = getStudents().filter(function (s) { return s.id === id; });
    return found.length ? found[0] : null;
  }

  /** لون الشارة حسب النسبة (≥75% أخضر، ≥50% أصفر، وإلا أحمر) */
  function ratioBadge(ratio) {
    if (ratio >= 0.75) return "badge-ok";
    if (ratio >= 0.5) return "badge-warn";
    return "badge-bad";
  }

  /* ----- نموذج التلميذ ----- */

  function resetStudentForm() {
    $("#studentForm").reset();
    $("#studentId").value = "";
    $("#studentFormTitle").textContent = "تلميذ جديد";
    $("#studentError").classList.add("is-hidden");
  }

  function openStudentForm() {
    $("#studentFormCard").classList.remove("is-hidden");
    $("#studentFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("studentName").focus(); }, 300);
  }

  function closeStudentForm() {
    $("#studentFormCard").classList.add("is-hidden");
  }

  function submitStudent(e) {
    e.preventDefault();

    var data = {};
    STUDENT_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });

    var missing = [];
    if (!data.studentName) missing.push("اسم التلميذ");
    if (!data.studentGrade) missing.push("الصف والشعبة");

    var errBox = $("#studentError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#studentId").value;
    var list = getStudents();

    if (id) {
      var found = false;
      list = list.map(function (s) {
        if (s.id === id) {
          found = true;
          return Object.assign({}, s, data, { updatedAt: new Date().toISOString() });
        }
        return s;
      });
      if (!found) { toast("⚠️ لم يتم العثور على التلميذ المطلوب"); return; }
      if (saveStudents(list)) toast("✅ تم تعديل بيانات التلميذ");
    } else {
      var student = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data,
        { grades: [], attendance: [] }
      );
      list.unshift(student);
      if (saveStudents(list)) toast("✅ حُفظ التلميذ");
    }

    resetStudentForm();
    closeStudentForm();
    renderStudents();
  }

  function editStudent(id) {
    var s = findStudent(id);
    if (!s) return;

    resetStudentForm();
    $("#studentId").value = s.id;
    STUDENT_FIELDS.forEach(function (f) {
      if (s[f.id] !== undefined) document.getElementById(f.id).value = s[f.id];
    });
    $("#studentFormTitle").textContent = "تعديل بيانات: " + (s.studentName || "");
    openStudentForm();
  }

  function deleteStudent(id) {
    var s = findStudent(id);
    if (!s) return;

    var ok = window.confirm("هل تريدين حذف التلميذ «" + (s.studentName || "بدون اسم") +
      "» نهائيًا؟ سيتم حذف درجاته وسجل حضوره معه.");
    if (!ok) return;

    var list = getStudents().filter(function (x) { return x.id !== id; });
    if (saveStudents(list)) {
      if (panelStudentId === id) { panelStudentId = null; renderStudentPanel(); }
      toast("🗑️ تم حذف التلميذ");
      renderStudents();
    }
  }

  /* ----- لوحة الدرجات والحضور ----- */

  /** تعديل تلميذ ثم إعادة حفظ القائمة (يُستخدم لإضافة/حذف درجة أو حضور) */
  function mutateStudent(id, mutator) {
    var list = getStudents();
    var found = false;
    list = list.map(function (s) {
      if (s.id === id) {
        found = true;
        mutator(s);
        s.updatedAt = new Date().toISOString();
      }
      return s;
    });
    return found && saveStudents(list);
  }

  function renderGrades(s) {
    var grades = Array.isArray(s.grades) ? s.grades : [];
    $("#gradeCount").textContent = grades.length;

    var list = $("#gradeList");
    var empty = $("#gradeEmpty");

    if (grades.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("is-hidden");
      return;
    }
    empty.classList.add("is-hidden");

    list.innerHTML = grades.map(function (g) {
      var ratio = g.max > 0 ? g.degree / g.max : 0;
      return '' +
        '<div class="mini-item">' +
          '<div class="mini-item-main">' +
            '<strong>' + esc(g.exam) + '</strong>' +
            '<div class="mini-item-sub">' + esc(fmtDate(g.date)) + ' · من أصل ' + esc(String(g.max)) + '</div>' +
          '</div>' +
          '<span class="badge ' + ratioBadge(ratio) + '">' + esc(String(g.degree)) + ' / ' + esc(String(g.max)) + '</span>' +
          '<button type="button" class="btn btn-danger" data-gdel="' + esc(g.id) + '" title="حذف الدرجة">🗑️</button>' +
        '</div>';
    }).join("");
  }

  function renderAttendance(s) {
    var records = Array.isArray(s.attendance) ? s.attendance : [];
    $("#attCount").textContent = records.length;

    var list = $("#attList");
    var empty = $("#attEmpty");

    if (records.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("is-hidden");
      return;
    }
    empty.classList.add("is-hidden");

    var badgeFor = { "حاضر": "badge-ok", "غائب": "badge-bad", "متأخر": "badge-warn", "مستأذن": "badge-info" };

    list.innerHTML = records.map(function (r) {
      return '' +
        '<div class="mini-item">' +
          '<div class="mini-item-main">' +
            '<strong>' + esc(fmtDate(r.date)) + '</strong>' +
          '</div>' +
          '<span class="badge ' + (badgeFor[r.status] || "badge-info") + '">' + esc(r.status) + '</span>' +
          '<button type="button" class="btn btn-danger" data-adel="' + esc(r.id) + '" title="حذف السجل">🗑️</button>' +
        '</div>';
    }).join("");
  }

  function renderStudentPanel() {
    var s = panelStudentId ? findStudent(panelStudentId) : null;

    if (!s) {
      panelStudentId = null;
      $("#studentPanel").classList.add("is-hidden");
      return;
    }

    $("#studentPanel").classList.remove("is-hidden");
    $("#studentPanelTitle").textContent = "سجل التلميذ: " + (s.studentName || "") +
      (s.studentSerial ? " · رقم القيد " + s.studentSerial : "") +
      (s.studentGrade ? " · " + s.studentGrade : "");

    $("#gradeForm").reset();
    $("#gradeMax").value = "20";
    $("#attDate").value = todayISO();
    $("#gradeError").classList.add("is-hidden");
    $("#attError").classList.add("is-hidden");

    renderGrades(s);
    renderAttendance(s);
  }

  function submitGrade(e) {
    e.preventDefault();
    var s = findStudent(panelStudentId);
    if (!s) { toast("⚠️ اختاري تلميذًا من القائمة أولًا"); return; }

    var exam = ($("#gradeExam").value || "").trim();
    var degree = parseFloat($("#gradeDegree").value);
    var max = parseFloat($("#gradeMax").value);
    if (!isFinite(max) || max <= 0) max = 20;

    var errs = [];
    if (!exam) errs.push("اسم التقويم / الاختبار");
    if (!isFinite(degree)) errs.push("الدرجة");
    else if (degree < 0) errs.push("أن تكون الدرجة صفرًا أو أكثر");
    else if (degree > max) errs.push("أن لا تتجاوز الدرجة " + max + " (من أصلها)");

    var errBox = $("#gradeError");
    if (errs.length) {
      errBox.textContent = "الرجاء: " + errs.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var grade = { id: uid(), exam: exam, degree: degree, max: max, date: todayISO() };

    if (mutateStudent(s.id, function (st) {
      st.grades = [grade].concat(Array.isArray(st.grades) ? st.grades : []);
    })) {
      $("#gradeExam").value = "";
      $("#gradeDegree").value = "";
      $("#gradeExam").focus();
      toast("✅ أُضيفت الدرجة");
      renderGrades(findStudent(s.id) || s);
      renderStudents();
    }
  }

  function deleteGrade(gid) {
    var s = findStudent(panelStudentId);
    if (!s) return;

    var grade = (Array.isArray(s.grades) ? s.grades : []).filter(function (g) { return g.id === gid; })[0];
    if (!grade) return;

    var ok = window.confirm("حذف درجة «" + grade.exam + "» من سجل هذا التلميذ؟");
    if (!ok) return;

    if (mutateStudent(s.id, function (st) {
      st.grades = (Array.isArray(st.grades) ? st.grades : []).filter(function (g) { return g.id !== gid; });
    })) {
      toast("🗑️ تم حذف الدرجة");
      renderGrades(findStudent(s.id) || s);
      renderStudents();
    }
  }

  function submitAttendance(e) {
    e.preventDefault();
    var s = findStudent(panelStudentId);
    if (!s) { toast("⚠️ اختاري تلميذًا من القائمة أولًا"); return; }

    var date = $("#attDate").value;
    var status = $("#attStatus").value;

    var errBox = $("#attError");
    if (!date) {
      errBox.textContent = "الرجاء اختيار التاريخ.";
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var dup = (Array.isArray(s.attendance) ? s.attendance : [])
      .filter(function (r) { return r.date === date; });

    if (dup.length) {
      var ok = window.confirm("يوجد سجل بهذا التاريخ (" + fmtDate(date) + ") بحالة «" +
        dup[0].status + "». هل استبداله بـ«" + status + "»؟");
      if (!ok) return;

      if (mutateStudent(s.id, function (st) {
        st.attendance = (Array.isArray(st.attendance) ? st.attendance : []).map(function (r) {
          return r.date === date ? { id: r.id, date: date, status: status } : r;
        });
      })) {
        toast("✅ تم تحديث سجل هذا اليوم");
        renderAttendance(findStudent(s.id) || s);
        renderStudents();
      }
      return;
    }

    var record = { id: uid(), date: date, status: status };

    if (mutateStudent(s.id, function (st) {
      var arr = Array.isArray(st.attendance) ? st.attendance.slice() : [];
      arr.push(record);
      arr.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
      st.attendance = arr;
    })) {
      toast("✅ سُجّل يوم " + fmtDate(date) + " بحالة: " + status);
      renderAttendance(findStudent(s.id) || s);
      renderStudents();
    }
  }

  function deleteAttendance(rid) {
    var s = findStudent(panelStudentId);
    if (!s) return;

    var rec = (Array.isArray(s.attendance) ? s.attendance : []).filter(function (r) { return r.id === rid; })[0];
    if (!rec) return;

    var ok = window.confirm("حذف سجل يوم " + fmtDate(rec.date) + " (" + rec.status + ")؟");
    if (!ok) return;

    if (mutateStudent(s.id, function (st) {
      st.attendance = (Array.isArray(st.attendance) ? st.attendance : []).filter(function (r) { return r.id !== rid; });
    })) {
      toast("🗑️ تم حذف السجل");
      renderAttendance(findStudent(s.id) || s);
      renderStudents();
    }
  }

  /* ----- قائمة التلاميذ ----- */

  /** تعبئة ترشيح الصفوف من القيم الموجودة فعليًا */
  function fillStudentFilter() {
    var sel = $("#studentFilter");
    var current = sel.value;
    var grades = [];
    getStudents().forEach(function (s) {
      if (s.studentGrade && grades.indexOf(s.studentGrade) === -1) grades.push(s.studentGrade);
    });

    sel.innerHTML = '<option value="">الكل</option>' + grades.map(function (g) {
      return '<option value="' + esc(g) + '">' + esc(g) + "</option>";
    }).join("");

    if (grades.indexOf(current) !== -1) sel.value = current;
  }

  /** أسماء التلاميذ لاقتراحها في قسم الفروق الفردية */
  function renderStudentNames() {
    var box = $("#studentNames");
    if (!box) return;
    box.innerHTML = getStudents().map(function (s) {
      return '<option value="' + esc(s.studentName) + '"></option>';
    }).join("");
  }

  function renderStudents() {
    fillStudentFilter();
    renderStudentNames();

    var list = getStudents();
    var query = ($("#studentSearch").value || "").trim().toLowerCase();
    var grade = $("#studentFilter").value;

    var filtered = list;
    if (grade) filtered = filtered.filter(function (s) { return s.studentGrade === grade; });
    if (query) {
      filtered = filtered.filter(function (s) {
        var haystack = [s.studentName, s.studentSerial, s.studentGrade, s.studentNote].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#studentCount").textContent = list.length;
    var container = $("#studentList");
    var emptyBox = $("#studentEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      if (query || grade) {
        emptyBox.textContent = "لا يوجد تلاميذ مطابقون لخيارات البحث الحالية.";
      } else {
        emptyBox.innerHTML = "لا يوجد تلاميذ بعد. اضغطي <strong>＋ تلميذ جديد</strong> للبدء.";
      }
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (s) {
      var gCount = Array.isArray(s.grades) ? s.grades.length : 0;
      var aCount = Array.isArray(s.attendance) ? s.attendance.length : 0;
      var meta = [];
      if (s.studentSerial) meta.push("قيد " + esc(s.studentSerial));
      if (s.studentGrade) meta.push(esc(s.studentGrade));
      meta.push(gCount + " درجة");
      meta.push(aCount + " سجل حضور");
      if (s.studentNote) meta.push(esc(s.studentNote));

      return '' +
        '<article class="prep-item student-item" data-id="' + esc(s.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' + esc(s.studentName || "بدون اسم") + '</div>' +
            '<div class="prep-item-meta">' + meta.join(" · ") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-student-action="panel">📊 درجات وحضور</button>' +
            '<button type="button" class="btn btn-outline" data-student-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-student-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindStudents() {
    $("#studentForm").addEventListener("submit", submitStudent);

    $("#btnNewStudent").addEventListener("click", function () {
      resetStudentForm();
      openStudentForm();
    });

    $("#btnCancelStudent").addEventListener("click", function () {
      resetStudentForm();
      closeStudentForm();
    });

    $("#btnResetStudent").addEventListener("click", function () {
      if (!window.confirm("تفريغ حقول النموذج؟ (لن يُحذف أي تلميذ محفوظ)")) return;
      resetStudentForm();
    });

    $("#studentSearch").addEventListener("input", renderStudents);
    $("#studentFilter").addEventListener("change", renderStudents);

    $("#studentList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-student-action]");
      if (!btn) return;
      var item = btn.closest(".student-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-student-action");

      if (action === "edit") editStudent(id);
      else if (action === "delete") deleteStudent(id);
      else if (action === "panel") {
        panelStudentId = id;
        renderStudentPanel();
        $("#studentPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    $("#btnClosePanel").addEventListener("click", function () {
      panelStudentId = null;
      renderStudentPanel();
    });

    $("#gradeForm").addEventListener("submit", submitGrade);
    $("#attForm").addEventListener("submit", submitAttendance);

    $("#gradeList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-gdel]");
      if (btn) deleteGrade(btn.getAttribute("data-gdel"));
    });

    $("#attList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-adel]");
      if (btn) deleteAttendance(btn.getAttribute("data-adel"));
    });

    $("#btnPrintGrades").addEventListener("click", function () { printStudentSheet("grades"); });
    $("#btnPrintAttendance").addEventListener("click", function () { printStudentSheet("attendance"); });
  }

  /* ---------------- 15) الفروق الفردية ---------------- */

  var DIFF_FIELDS = [
    { id: "diffStudent",    label: "اسم التلميذ" },
    { id: "diffLevel",      label: "المستوى العام" },
    { id: "diffDate",       label: "تاريخ الملاحظة" },
    { id: "diffStrengths",  label: "نقاط القوة" },
    { id: "diffNeeds",      label: "نقاط الضعف / الاحتياجات" },
    { id: "diffPlan",       label: "خطة التكيف" },
    { id: "diffNote",       label: "ملاحظات إضافية" }
  ];

  function getDiffs() {
    var list = storageGet(KEYS.diffs, []);
    return Array.isArray(list) ? list : [];
  }

  function saveDiffs(list) {
    return storageSet(KEYS.diffs, list);
  }

  function resetDiffForm() {
    $("#diffForm").reset();
    $("#diffId").value = "";
    $("#diffDate").value = todayISO();
    $("#diffFormTitle").textContent = "ملف فروق فردية جديد";
    $("#diffError").classList.add("is-hidden");
  }

  function openDiffForm() {
    $("#diffFormCard").classList.remove("is-hidden");
    $("#diffFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { document.getElementById("diffStudent").focus(); }, 300);
  }

  function closeDiffForm() {
    $("#diffFormCard").classList.add("is-hidden");
  }

  function submitDiff(e) {
    e.preventDefault();

    var data = {};
    DIFF_FIELDS.forEach(function (f) {
      data[f.id] = (document.getElementById(f.id).value || "").trim();
    });

    var missing = [];
    if (!data.diffStudent) missing.push("اسم التلميذ");
    if (!data.diffStrengths) missing.push("نقاط القوة");
    if (!data.diffNeeds) missing.push("نقاط الضعف / الاحتياجات");
    if (!data.diffPlan) missing.push("خطة التكيف");

    var errBox = $("#diffError");
    if (missing.length) {
      errBox.textContent = "الرجاء تعبئة الحقول التالية: " + missing.join("، ");
      errBox.classList.remove("is-hidden");
      return;
    }
    errBox.classList.add("is-hidden");

    var id = $("#diffId").value;
    var list = getDiffs();

    if (id) {
      var found = false;
      list = list.map(function (d) {
        if (d.id === id) {
          found = true;
          return Object.assign({}, d, data, { updatedAt: new Date().toISOString() });
        }
        return d;
      });
      if (!found) { toast("⚠️ لم يتم العثور على الملف المطلوب"); return; }
      if (saveDiffs(list)) toast("✅ تم تعديل الملف");
    } else {
      var diff = Object.assign(
        { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        data
      );
      list.unshift(diff);
      if (saveDiffs(list)) toast("✅ حُفظ ملف الفروق الفردية");
    }

    resetDiffForm();
    closeDiffForm();
    renderDiffs();
  }

  function editDiff(id) {
    var d = getDiffs().filter(function (x) { return x.id === id; })[0];
    if (!d) return;

    resetDiffForm();
    $("#diffId").value = d.id;
    DIFF_FIELDS.forEach(function (f) {
      if (d[f.id] !== undefined) document.getElementById(f.id).value = d[f.id];
    });
    $("#diffFormTitle").textContent = "تعديل ملف: " + (d.diffStudent || "");
    openDiffForm();
  }

  function deleteDiff(id) {
    var d = getDiffs().filter(function (x) { return x.id === id; })[0];
    if (!d) return;

    var ok = window.confirm("هل تريدين حذف ملف الفروق الفردية للتلميذ «" +
      (d.diffStudent || "بدون اسم") + "» نهائيًا؟");
    if (!ok) return;

    var list = getDiffs().filter(function (x) { return x.id !== id; });
    if (saveDiffs(list)) {
      toast("🗑️ تم حذف الملف");
      renderDiffs();
    }
  }

  var LEVEL_BADGE = { "متقدم": "badge-ok", "ضمن المستوى": "badge-info", "يحتاج دعمًا": "badge-warn" };

  function renderDiffs() {
    var list = getDiffs();
    var query = ($("#diffSearch").value || "").trim().toLowerCase();
    var level = $("#diffFilter").value;

    var filtered = list;
    if (level) filtered = filtered.filter(function (d) { return d.diffLevel === level; });
    if (query) {
      filtered = filtered.filter(function (d) {
        var haystack = [d.diffStudent, d.diffLevel, d.diffStrengths, d.diffNeeds, d.diffPlan, d.diffNote]
          .join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    $("#diffCount").textContent = list.length;
    var container = $("#diffList");
    var emptyBox = $("#diffEmpty");

    if (filtered.length === 0) {
      container.innerHTML = "";
      emptyBox.classList.remove("is-hidden");
      if (query || level) {
        emptyBox.textContent = "لا توجد ملفات مطابقة لخيارات البحث الحالية.";
      } else {
        emptyBox.innerHTML = "لا توجد ملفات فروق فردية بعد. اضغطي <strong>＋ ملف فروق فردية</strong> للبدء.";
      }
      return;
    }

    emptyBox.classList.add("is-hidden");
    container.innerHTML = filtered.map(function (d) {
      var meta = [];
      if (d.diffDate) meta.push(esc(fmtDate(d.diffDate)));
      meta.push("قوة: " + esc((d.diffStrengths || "").slice(0, 45)) + ((d.diffStrengths || "").length > 45 ? "…" : ""));
      meta.push("احتياج: " + esc((d.diffNeeds || "").slice(0, 45)) + ((d.diffNeeds || "").length > 45 ? "…" : ""));

      return '' +
        '<article class="prep-item diff-item" data-id="' + esc(d.id) + '">' +
          '<div class="prep-item-main">' +
            '<div class="prep-item-title">' +
              '<span class="chip">' + esc(d.diffLevel || "") + '</span>' +
              esc(d.diffStudent || "بدون اسم") +
            '</div>' +
            '<div class="prep-item-meta">' + meta.join(" · ") + '</div>' +
          '</div>' +
          '<div class="prep-item-actions">' +
            '<button type="button" class="btn btn-outline" data-diff-action="print">🖨️ طباعة</button>' +
            '<button type="button" class="btn btn-outline" data-diff-action="edit">✏️ تعديل</button>' +
            '<button type="button" class="btn btn-danger" data-diff-action="delete">🗑️ حذف</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindDiffs() {
    $("#diffForm").addEventListener("submit", submitDiff);

    $("#btnNewDiff").addEventListener("click", function () {
      resetDiffForm();
      openDiffForm();
    });

    $("#btnCancelDiff").addEventListener("click", function () {
      resetDiffForm();
      closeDiffForm();
    });

    $("#btnResetDiff").addEventListener("click", function () {
      if (!window.confirm("تفريغ جميع الحقول؟ (لن يُحذف أي ملف محفوظ)")) return;
      resetDiffForm();
    });

    $("#diffSearch").addEventListener("input", renderDiffs);
    $("#diffFilter").addEventListener("change", renderDiffs);

    $("#diffList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-diff-action]");
      if (!btn) return;
      var item = btn.closest(".diff-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      var action = btn.getAttribute("data-diff-action");

      if (action === "edit") editDiff(id);
      else if (action === "delete") deleteDiff(id);
      else if (action === "print") printDiff(id);
    });
  }

  /* ---------------- 16) الطباعة: كشف الدرجات وكشف الحضور وبطاقة الفروق ---------------- */

  function printStudentSheet(kind) {
    var s = findStudent(panelStudentId);
    if (!s) { toast("⚠️ افتحي سجل تلميذ أولًا"); return; }

    var html = kind === "attendance" ? buildAttendancePrintDoc(s) : buildGradesPrintDoc(s);
    if (!html) return;

    $("#printArea").innerHTML = html;
    document.body.classList.add("print-mode");
    window.print();
  }

  function buildGradesPrintDoc(s) {
    var basic = getBasic();
    var grades = Array.isArray(s.grades) ? s.grades : [];

    if (grades.length === 0) { toast("لا توجد درجات مسجلة لهذا التلميذ بعد."); return ""; }

    var sumDeg = 0, sumMax = 0;
    grades.forEach(function (g) { sumDeg += g.degree; sumMax += g.max; });
    sumDeg = Math.round(sumDeg * 100) / 100;
    var avg = sumMax > 0 ? Math.round((sumDeg / sumMax) * 100) : 0;

    var body = grades.map(function (g, i) {
      var pct = g.max > 0 ? Math.round((g.degree / g.max) * 100) : 0;
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(g.exam) + '</td>' +
        '<td>' + esc(String(g.degree)) + '</td>' +
        '<td>' + esc(String(g.max)) + '</td>' +
        '<td>' + pct + '%</td>' +
        '<td>' + esc(fmtDate(g.date)) + '</td>' +
      '</tr>';
    }).join("");

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>كشف درجات التلميذ</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' +
          '<div><strong>اسم التلميذ:</strong> ' + esc(s.studentName || "") + '</div>' +
          (s.studentSerial ? '<div><strong>رقم القيد:</strong> ' + esc(s.studentSerial) + '</div>' : "") +
          '<div><strong>الصف والشعبة:</strong> ' + esc(s.studentGrade || "") + '</div>' +
          '<div><strong>عدد التقويمات:</strong> ' + grades.length + '</div>' +
        '</div>' +

        '<section class="print-block">' +
          '<h2>سجل الدرجات</h2>' +
          '<table class="print-table">' +
            '<thead><tr><th style="width:7%">م</th><th>التقويم / الاختبار</th><th style="width:12%">الدرجة</th>' +
            '<th style="width:12%">من أصل</th><th style="width:12%">النسبة</th><th style="width:16%">التاريخ</th></tr></thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>' +
          '<p class="print-total">المجموع: ' + sumDeg + ' من ' + sumMax + ' · المتوسط العام: ' + avg + '%</p>' +
        '</section>' +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function buildAttendancePrintDoc(s) {
    var basic = getBasic();
    var records = Array.isArray(s.attendance) ? s.attendance : [];

    if (records.length === 0) { toast("لا توجد سجلات حضور لهذا التلميذ بعد."); return ""; }

    var counts = { "حاضر": 0, "غائب": 0, "متأخر": 0, "مستأذن": 0 };
    records.forEach(function (r) {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
      else counts[r.status] = 1;
    });

    var presentRatio = records.length > 0
      ? Math.round(((counts["حاضر"] + counts["مستأذن"]) / records.length) * 100)
      : 0;

    var body = records.map(function (r, i) {
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(fmtDate(r.date)) + '</td>' +
        '<td>' + esc(r.status) + '</td>' +
      '</tr>';
    }).join("");

    return '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>كشف الحضور والغياب</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' +
          '<div><strong>اسم التلميذ:</strong> ' + esc(s.studentName || "") + '</div>' +
          (s.studentSerial ? '<div><strong>رقم القيد:</strong> ' + esc(s.studentSerial) + '</div>' : "") +
          '<div><strong>الصف والشعبة:</strong> ' + esc(s.studentGrade || "") + '</div>' +
          '<div><strong>عدد الأيام المسجلة:</strong> ' + records.length + '</div>' +
        '</div>' +

        '<section class="print-block">' +
          '<h2>سجل الحضور</h2>' +
          '<table class="print-table">' +
            '<thead><tr><th style="width:10%">م</th><th style="width:45%">التاريخ</th><th>الحالة</th></tr></thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>' +
          '<p class="print-total">حاضر: ' + counts["حاضر"] + ' · غائب: ' + counts["غائب"] +
            ' · متأخر: ' + counts["متأخر"] + ' · مستأذن: ' + counts["مستأذن"] +
            ' · نسبة الحضور: ' + presentRatio + '%</p>' +
        '</section>' +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';
  }

  function printDiff(id) {
    var d = getDiffs().filter(function (x) { return x.id === id; })[0];
    if (!d) { toast("⚠️ لم يتم العثور على الملف"); return; }

    var basic = getBasic();

    var block = function (title, text) {
      return (text || "").trim()
        ? '<section class="print-block"><h2>' + title + '</h2><div class="print-body">' + esc(text) + '</div></section>'
        : "";
    };

    $("#printArea").innerHTML = '' +
      '<div class="print-doc">' +
        '<header class="print-head">' +
          '<h1>بطاقة الفروق الفردية</h1>' +
          '<div class="print-sub">' + esc(basic.bdSubject || "الرياضيات") + ' – ' + esc(basic.bdStage || "المرحلة الإعدادية") + '</div>' +
          '<div class="print-meta">' +
            (basic.bdSchool ? esc(basic.bdSchool) + " · " : "") +
            (basic.bdTeacher ? "المعلم(ة): " + esc(basic.bdTeacher) : "") +
          '</div>' +
        '</header>' +

        '<div class="print-info">' +
          '<div><strong>اسم التلميذ:</strong> ' + esc(d.diffStudent || "") + '</div>' +
          '<div><strong>المستوى العام:</strong> ' + esc(d.diffLevel || "") + '</div>' +
          (d.diffDate ? '<div><strong>تاريخ الملاحظة:</strong> ' + esc(fmtDate(d.diffDate)) + '</div>' : "") +
        '</div>' +

        block("نقاط القوة", d.diffStrengths) +
        block("نقاط الضعف / الاحتياجات", d.diffNeeds) +
        block("خطة التكيف وأنشطة مقترحة", d.diffPlan) +
        block("ملاحظات إضافية", d.diffNote) +

        '<footer class="print-foot">' +
          '<span>التوقيع: ..............................</span>' +
          '<span>اعتماد المدير: ..............................</span>' +
        '</footer>' +
      '</div>';

    document.body.classList.add("print-mode");
    window.print();
  }

  /* ---------------- 17) بدء التشغيل ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    bindAuth();
    initAuth();
    bindNavigation();
    bindBasic();
    bindPreps();
    bindNotes();
    bindActivities();
    bindTests();
    bindPlans();
    bindStudents();
    bindDiffs();
    bindBackup();
    fillCategoryOptions();
    fillTestOptions();
    fillPlanTypeOptions();
    loadBasic();
    resetPrepForm();
    renderPreps();
    resetNoteForm();
    renderNotes();
    resetActivityForm();
    renderActivities();
    resetTestForm();
    renderTests();
    resetPlanForm();
    renderPlans();
    resetStudentForm();
    renderStudents();
    resetDiffForm();
    renderDiffs();
  });

})();
