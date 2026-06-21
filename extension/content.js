(function () {
  "use strict";

  const BUTTON_TEXT = "問題を抽出";
  const MODAL_TITLE = "抽出された問題 (LaTeX)";
  const QUESTION_SELECTOR = "div.que";
  const QUESTION_NUMBER_SELECTOR = ".qno";
  const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext";
  const FORMULATION_SELECTOR = ".formulation";
  const ANSWER_BLOCK_SELECTOR = ".ablock .answer";
  const OPTION_LABEL_SELECTOR = "div[data-region='answer-label']";
  const FORMULA_IMG_SELECTOR = "img.Wirisformula[data-mathml]";
  const TEXT_SEPARATOR = "\n\n---\n\n";
  const HEADER_ACTION_CONTAINER_SELECTOR =
    "div.header-actions-container[data-region='header-actions-container']";
  const OPTIONS_HEADER = "\n\n選択肢:";
  const DELIM = "$";

  const INSTRUCTION_HEADER =
    "以下の各 [[番号]] に対応する解答を、次の形式で返してください（1 行 1 つ）:\n" +
    "[[番号]] = 値\n" +
    "重要: 値は入力欄にそのまま入る **プレーンな数値 / 短い文字列** のみ。\n" +
    "  - `$`, `\\(...\\)`, `\\[...\\]` などの LaTeX 区切りで絶対に囲まない。\n" +
    "  - `\\frac{1}{2}` のようなコマンドを使わない。許容される形式の例: `0.5`, `1/2`, `-1/2`, `-3.14`, `38293`, `sqrt(2)`。\n" +
    "  - 選択式はラベル文字 または 選択肢本文をそのまま値にする。\n" +
    "  - チェックボックスが選択肢ごとに個別の回答欄として示される場合は、選択する欄を `1`、選択しない欄を `0` にする。\n\n" +
    "重要: 解答に必要な情報（データ、画像、図表、条件、選択肢など）が不足している場合は、推測や解答を一切しない。`[[番号]] = 値` 形式も出力せず、不足している情報だけを具体的にユーザーへ伝える。\n\n" +
    "=====\n\n";

  const answerMap = new Map();

  function cleanMathML(s) {
    if (!s) return "";
    return s.replace(/¨/g, '"').replace(/«/g, "<").replace(/»/g, ">");
  }

  function toLatex(mathml) {
    if (!mathml) return null;
    try {
      const lib = window.MathMLToLaTeX;
      if (!lib || !lib.MathMLToLaTeX || typeof lib.MathMLToLaTeX.convert !== "function") {
        return "[MathMLToLaTeX Library Error]";
      }
      return lib.MathMLToLaTeX.convert(mathml);
    } catch (e) {
      return `[Conversion Error: ${e.message}]`;
    }
  }

  function isFillableInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return ["text", "number", "tel", "radio", "checkbox"].includes(t);
  }

  function isHelperInput(el) {
    const name = el.getAttribute("name") || "";
    if (/(:_:flagged|:_:sequencecheck|_:sequencecheck|sesskey|slots)/.test(name)) return true;
    if (el.closest(".questionflag")) return true;
    return false;
  }

  function labelTextFor(input) {
    if (input.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lab) return cleanup(extractTextWithFormulas(lab));
    }
    const parentLab = input.closest("label");
    if (parentLab) return cleanup(extractTextWithFormulas(parentLab));
    const ansLabel = input.parentElement && input.parentElement.querySelector(OPTION_LABEL_SELECTOR);
    if (ansLabel) return cleanup(extractTextWithFormulas(ansLabel));
    return "";
  }

  function assignIdsForQuestion(qEl, qNum) {
    const placeholders = [];
    const inputs = Array.from(qEl.querySelectorAll("input, textarea, select")).filter(
      (el) => isFillableInput(el) && !isHelperInput(el)
    );

    let sub = 0;
    const radioGroups = new Map();

    inputs.forEach((el) => {
      const tag = el.tagName;
      const type = (el.type || "").toLowerCase();

      if (tag === "INPUT" && (type === "radio" || type === "checkbox")) {
        const name = el.getAttribute("name") || `__${qNum}__${sub}`;
        if (!radioGroups.has(name)) {
          sub += 1;
          const id = `${qNum}.${sub}`;
          radioGroups.set(name, { id, elements: [], type });
        }
        radioGroups.get(name).elements.push(el);
        el.dataset.mqeId = radioGroups.get(name).id;
        el.dataset.mqeRole = type;
      } else {
        sub += 1;
        const id = `${qNum}.${sub}`;
        el.dataset.mqeId = id;
        el.dataset.mqeRole = tag === "SELECT" ? "select" : tag === "TEXTAREA" ? "textarea" : "text";
        let options = null;
        if (tag === "SELECT") {
          options = Array.from(el.options).map((o) => ({
            value: o.value,
            text: (o.textContent || "").trim(),
          }));
        }
        answerMap.set(id, { role: el.dataset.mqeRole, el, options });
        placeholders.push(id);
      }
    });

    radioGroups.forEach((g) => {
      const opts = g.elements.map((r) => ({
        el: r,
        value: r.value,
        label: labelTextFor(r),
      }));
      answerMap.set(g.id, { role: g.type, elements: g.elements, options: opts });
      placeholders.push(g.id);
    });

    return { placeholders, radioGroups };
  }

  function extractTextWithFormulas(node) {
    let text = "";
    if (!node) return text;

    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return text;

    if (
      node.classList.contains("MathJax_Preview") ||
      node.classList.contains("MJX_Assistive_MathML")
    ) {
      return "";
    }

    if (node.tagName === "SCRIPT" && node.type && node.type.indexOf("math/tex") !== -1) {
      return ` ${DELIM}${node.textContent}${DELIM} `;
    }

    if (node.classList.contains("MathJax")) {
      const id = node.getAttribute("id");
      if (id && id.endsWith("-Frame")) {
        const scriptId = id.substring(0, id.length - 6);
        const scriptEl = document.getElementById(scriptId);
        if (
          scriptEl &&
          scriptEl.tagName === "SCRIPT" &&
          scriptEl.type &&
          scriptEl.type.indexOf("math/tex") !== -1
        ) {
          return "";
        }
      }
      const raw = node.getAttribute("data-mathml");
      if (raw) {
        const latex = toLatex(cleanMathML(raw));
        if (latex && !latex.startsWith("[Conversion Error:") && !latex.startsWith("[MathMLToLaTeX Library Error]")) {
          return ` ${DELIM}${latex}${DELIM} `;
        }
      }
    }

    if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
      const raw = node.getAttribute("data-mathml");
      const alt = node.getAttribute("alt");
      if (raw) {
        const latex = toLatex(cleanMathML(raw));
        if (latex && !latex.startsWith("[Conversion Error:") && !latex.startsWith("[MathMLToLaTeX Library Error]")) {
          text += ` ${DELIM}${latex}${DELIM} `;
        } else if (latex) {
          text += ` ${latex} `;
        } else if (alt) {
          text += ` [Formula Alt Text: ${alt}] `;
        } else {
          text += " [Formula Error] ";
        }
      } else if (alt) {
        text += ` [Formula Alt Text: ${alt}] `;
      } else {
        text += " [Formula Image - No Data] ";
      }
      return text;
    }

    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const id = node.dataset && node.dataset.mqeId;
      const role = node.dataset && node.dataset.mqeRole;
      if (id) {
        if (role === "radio" || role === "checkbox") return "";
        return ` [[${id}]] `;
      }
      return "";
    }

    const blockTags = ["P","DIV","H1","H2","H3","H4","H5","H6","LI","TR","DT","DD","BLOCKQUOTE","FIELDSET","LEGEND","UL","OL","TABLE"];
    const isBlock = blockTags.includes(tag);
    const isBr = tag === "BR";

    node.childNodes.forEach((c) => {
      text += extractTextWithFormulas(c);
    });

    if ((isBlock || isBr) && !/\s\s$/.test(text)) text += "\n";
    return text;
  }

  function cleanup(s) {
    if (!s) return "";
    let c = s.replace(/[\s\u00A0]+/g, " ");
    c = c.replace(/([^\s$])\$/g, "$1 $");
    c = c.replace(/\$([^\s$])/g, "$ $1");
    c = c.replace(/ *\n */g, "\n");
    c = c.replace(/\n{3,}/g, "\n\n");
    return c.trim();
  }

  function getAllQuestionTexts() {
    answerMap.clear();
    document
      .querySelectorAll("[data-mqe-id]")
      .forEach((el) => {
        delete el.dataset.mqeId;
        delete el.dataset.mqeRole;
      });

    const qs = document.querySelectorAll(QUESTION_SELECTOR);
    const out = [];

    qs.forEach((qEl, idx) => {
      const numberEl = qEl.querySelector(QUESTION_NUMBER_SELECTOR);
      const infoEl = qEl.querySelector(".info .no");
      const textEl = qEl.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
      const formEl = qEl.querySelector(FORMULATION_SELECTOR);

      const qNum = numberEl ? numberEl.textContent.trim() : `${idx + 1}`;
      const { radioGroups } = assignIdsForQuestion(qEl, qNum);

      const rawTitle = infoEl ? extractTextWithFormulas(infoEl) : `問題 ${qNum}`;
      const title = cleanup(rawTitle);

      let body = "";
      const container = textEl || formEl;
      if (container) {
        body = cleanup(extractTextWithFormulas(container));
      } else {
        const c = qEl.querySelector(".content");
        body = c ? cleanup(extractTextWithFormulas(c)) : "[問題テキストが見つかりません]";
      }

      if (body.startsWith(title + ":")) body = body.substring(title.length + 1).trim();
      else if (body.startsWith(title)) body = body.substring(title.length).trim();

      let opts = "";
      const aEl = qEl.querySelector(ANSWER_BLOCK_SELECTOR);
      if (aEl) {
        const labels = aEl.querySelectorAll(OPTION_LABEL_SELECTOR);
        const list = [];
        labels.forEach((l) => {
          const t = cleanup(extractTextWithFormulas(l));
          if (t) list.push(`- ${t}`);
        });
        if (list.length) opts = OPTIONS_HEADER + "\n" + list.join("\n");
      }

      const groups = Array.from(radioGroups.values());
      const groupIds = groups.map((g) => g.id);
      if (groupIds.length) {
        const allIndividualCheckboxes = groups.every(
          (g) => g.type === "checkbox" && g.elements.length === 1
        );
        const answerFieldLabel = allIndividualCheckboxes
          ? "チェックボックス回答欄（選択肢と同順、1 = 選択、0 = 非選択）"
          : "回答欄";
        opts += `\n${answerFieldLabel}: ${groupIds.map((id) => `[[${id}]]`).join(", ")}`;
      }

      out.push(title + (body ? `\n${body}` : "") + opts);
    });

    return INSTRUCTION_HEADER + out.join(TEXT_SEPARATOR);
  }

  function fireInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function matchOption(candidates, value) {
    const v = value.trim();
    const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
    const nv = norm(v);
    let best = null;
    for (const c of candidates) {
      if (c.value != null && c.value !== "" && norm(c.value) === nv) return c;
      if (norm(c.label || c.text) === nv) return c;
    }
    for (const c of candidates) {
      const lab = norm(c.label || c.text);
      if (lab && (lab.includes(nv) || nv.includes(lab))) {
        best = best || c;
      }
    }
    return best;
  }

  function stripLatexWrap(s) {
    let v = s.trim();
    v = v.replace(/^\\\((.*)\\\)$/s, "$1").trim();
    v = v.replace(/^\\\[(.*)\\\]$/s, "$1").trim();
    v = v.replace(/^\$+([\s\S]*?)\$+$/s, "$1").trim();
    v = v.replace(/^\{([\s\S]*)\}$/s, "$1").trim();
    return v;
  }

  function parseCheckboxBoolean(value) {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return null;
  }

  function applyAnswer(id, rawValue) {
    let entry = answerMap.get(id);
    if (!entry && !id.includes(".")) entry = answerMap.get(`${id}.1`);
    if (!entry) return { ok: false, reason: `id ${id} not found` };
    const value = rawValue.trim();

    if (entry.role === "text" || entry.role === "textarea") {
      entry.el.value = stripLatexWrap(value);
      fireInputEvents(entry.el);
      return { ok: true };
    }

    if (entry.role === "select") {
      const cands = entry.options.map((o) => ({ ...o, el: entry.el }));
      const m = matchOption(cands, value);
      if (!m) return { ok: false, reason: `no matching option for ${id}` };
      entry.el.value = m.value;
      fireInputEvents(entry.el);
      return { ok: true };
    }

    if (entry.role === "radio") {
      const m = matchOption(entry.options, value);
      if (!m) return { ok: false, reason: `no matching radio for ${id}` };
      m.el.checked = true;
      fireInputEvents(m.el);
      return { ok: true };
    }

    if (entry.role === "checkbox") {
      if (entry.elements.length === 1) {
        const checked = parseCheckboxBoolean(value);
        if (checked !== null) {
          entry.elements[0].checked = checked;
          fireInputEvents(entry.elements[0]);
          return { ok: true };
        }

        const match = matchOption(entry.options, value);
        if (!match) {
          return { ok: false, reason: `expected 1, 0, or a matching label for checkbox ${id}` };
        }
        match.el.checked = true;
        fireInputEvents(match.el);
        return { ok: true };
      }

      const parts = value.split(/[,，、\/|]+/).map((s) => s.trim()).filter(Boolean);
      const targets = parts.length ? parts : [value];
      let any = false;
      for (const p of targets) {
        const m = matchOption(entry.options, p);
        if (m) {
          m.el.checked = true;
          fireInputEvents(m.el);
          any = true;
        }
      }
      return any ? { ok: true } : { ok: false, reason: `no matching checkbox for ${id}` };
    }

    return { ok: false, reason: `unknown role for ${id}` };
  }

  function parseAnswers(text) {
    const re = /\[\[\s*([0-9]+(?:\.[0-9]+)?)\s*\]\]\s*[=:＝：]\s*([\s\S]*?)(?=\n\s*\[\[\s*[0-9]+(?:\.[0-9]+)?\s*\]\]|$)/g;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ id: m[1], value: m[2].replace(/\s+$/g, "") });
    }
    return out;
  }

  function applyAllAnswers(text) {
    const pairs = parseAnswers(text);
    const filled = [];
    const skipped = [];
    for (const p of pairs) {
      const r = applyAnswer(p.id, p.value);
      if (r.ok) filled.push(p.id);
      else skipped.push(`${p.id} (${r.reason})`);
    }
    return { filled, skipped, total: pairs.length };
  }

  function openPDFWindow(text) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = esc(text)
      .split(/\n{2,}---\n{2,}/)
      .map((q) => `<section class="q">${q.replace(/\n/g, "<br>")}</section>`)
      .join("");

    const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${esc(MODAL_TITLE)}</title>
<script>
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']] },
  startup: {
    ready: () => {
      MathJax.startup.defaultReady();
      MathJax.startup.promise.then(() => { setTimeout(() => window.print(), 400); });
    }
  }
};
<\/script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" async><\/script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif; padding: 24px; line-height: 1.6; color: #111; max-width: 780px; margin: 0 auto; }
  h1 { font-size: 1.3em; margin: 0 0 16px; }
  .q { border-top: 1px solid #ccc; padding: 12px 0; page-break-inside: avoid; }
  .q:first-of-type { border-top: none; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${esc(MODAL_TITLE)}</h1>
${body}
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("ポップアップがブロックされました。このサイトのポップアップを許可してください。");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function showModal(text) {
    document.getElementById("mqe-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "mqe-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement("div");
    modal.id = "mqe-modal";

    const h2 = document.createElement("h2");
    h2.textContent = MODAL_TITLE;

    const hint = document.createElement("div");
    hint.id = "mqe-hint";
    hint.textContent =
      "コピー → Claude に貼付け → 回答をここに貼り付けて「解答を入力」を押すと解答欄へ自動入力されます。";

    const ta = document.createElement("textarea");
    ta.id = "mqe-textarea";
    ta.value = text;

    const status = document.createElement("div");
    status.id = "mqe-status";

    const btns = document.createElement("div");
    btns.id = "mqe-buttons";

    const copy = document.createElement("button");
    copy.className = "mqe-btn-copy";
    copy.textContent = "テキストをコピー";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        copy.textContent = "コピー完了!";
      } catch {
        ta.select();
        document.execCommand("copy");
        copy.textContent = "コピー完了!";
      }
      setTimeout(() => (copy.textContent = "テキストをコピー"), 1500);
    };

    const pdf = document.createElement("button");
    pdf.className = "mqe-btn-pdf";
    pdf.textContent = "PDF として保存";
    pdf.onclick = () => openPDFWindow(ta.value);

    const fill = document.createElement("button");
    fill.className = "mqe-btn-fill";
    fill.textContent = "解答を入力";
    fill.onclick = () => {
      const res = applyAllAnswers(ta.value);
      if (res.total === 0) {
        status.textContent = "『[[番号]] = 値』の形式が見つかりませんでした。";
        status.className = "mqe-status-err";
        return;
      }
      const msg =
        `${res.filled.length}/${res.total} 件を入力しました。` +
        (res.skipped.length ? `\nスキップ: ${res.skipped.join(", ")}` : "");
      status.textContent = msg;
      status.className = res.skipped.length ? "mqe-status-warn" : "mqe-status-ok";
    };

    const close = document.createElement("button");
    close.className = "mqe-btn-close";
    close.textContent = "閉じる";
    close.onclick = () => overlay.remove();

    btns.append(copy, pdf, fill, close);
    modal.append(h2, hint, ta, status, btns);
    overlay.append(modal);
    document.body.append(overlay);
    ta.focus();
  }

  function createButton() {
    if (document.getElementById("mqe-button")) return;

    const btn = document.createElement("button");
    btn.id = "mqe-button";
    btn.type = "button";
    btn.textContent = BUTTON_TEXT;
    btn.onclick = () => {
      try {
        if (!window.MathMLToLaTeX || !window.MathMLToLaTeX.MathMLToLaTeX) {
          alert("MathML-to-LaTeX ライブラリが読み込まれませんでした。");
          return;
        }
        const text = getAllQuestionTexts();
        if (!text.trim()) {
          alert("問題が見つかりませんでした。");
          return;
        }
        showModal(text);
      } catch (err) {
        console.error("MQE error:", err);
        alert("抽出中にエラーが発生しました。コンソールを確認してください。");
      }
    };

    const target = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
    if (target) {
      target.appendChild(btn);
    } else {
      btn.classList.add("mqe-button-fallback");
      document.body.appendChild(btn);
    }
  }

  function init() {
    setTimeout(createButton, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
