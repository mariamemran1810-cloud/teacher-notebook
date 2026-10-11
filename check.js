/* فحص ثابت للتطبيق بدون متصفح:
   1) سلامة بناء ملف JavaScript
   2) تطابق معرّفات العناصر (IDs) بين index.html و app.js
   3) تكرار المعرّفات داخل HTML
*/
const fs = require("fs");
const path = require("path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

let problems = [];

// 1) تكرار المعرّفات في HTML
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) problems.push("تكرار معرّفات في HTML: " + [...new Set(dupes)].join(", "));

// 2) معرّفات يبحث عنها JavaScript
const jsIds = new Set();
for (const m of js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) jsIds.add(m[1]);
for (const m of js.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)) jsIds.add(m[1]);
for (const m of js.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) jsIds.add(m[1]);

const missing = [...jsIds].filter(id => !ids.includes(id));
if (missing.length) problems.push("معرّفات يبحث عنها JS وغير موجودة في HTML: " + missing.join(", "));

// 3) أقسام التنقل تطابق عناصر العرض
const navViews = [...html.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
const missingViews = navViews.filter(v => !ids.includes("view-" + v));
if (missingViews.length) problems.push("أقسام تنقل بلا عنصر: " + missingViews.join(", "));

console.log("عدد معرّفات HTML:", ids.length);
console.log("عدد المعرّفات يبحث عنها JS:", jsIds.size);
console.log("أقسام التنقل:", navViews.length);
console.log(problems.length ? "مشاكل:\n- " + problems.join("\n- ") : "✅ لا مشاكل في الفحص الثابت");
process.exit(problems.length ? 1 : 0);
