// ==UserScript==
// @name         Moodle Quiz Extractor (Questions + Options + LaTeX v1.3)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Extracts Moodle quiz questions, options, converting formulas to LaTeX (using v1.3.0 library) for LLM input. Adds button near header.
// @author       Civilix
// @match        *://*/mod/quiz/attempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/attempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/processattempt.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moodle.org
// @require      https://cdn.jsdelivr.net/npm/mathml-to-latex@1.3.0/dist/bundle.min.js
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @license      MIT
// ==/UserScript==

/* global MathMLToLaTeX */

(function() {
    'use strict';

    // --- Configuration --- (Same as v1.6)
    const BUTTON_TEXT = "問題を抽出 (LaTeX)";
    const MODAL_TITLE = "抽出された問題と選択肢 (LaTeX)";
    const QUESTION_SELECTOR = "div.que";
    const QUESTION_NUMBER_SELECTOR = ".qno";
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext";
    const FORMULATION_SELECTOR = ".formulation";
    const ANSWER_BLOCK_SELECTOR = ".ablock .answer";
    const OPTION_LABEL_SELECTOR = "div[data-region='answer-label'], .r0 > label, .r1 > label";
    const FORMULA_IMG_SELECTOR = "img.Wirisformula";
    const TEXT_SEPARATOR = "\n\n---\n\n";
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']";
    const OPTIONS_HEADER = "\n\n選択肢:";
    const LATEX_INLINE_DELIMITER_START = " $";
    const LATEX_INLINE_DELIMITER_END = "$ ";

    // --- Styles --- (Same as v1.6)
    GM_addStyle(`
        #extract-questions-button { margin-left: 8px; padding: 5px 10px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px; box-shadow: 1px 1px 3px rgba(0,0,0,0.1); display: inline-block; vertical-align: middle; }
        #extract-questions-button:hover { background-color: #0056b3; }
        .extract-questions-button-fallback { position: fixed !important; bottom: 20px !important; right: 20px !important; z-index: 9999 !important; padding: 10px 15px !important; font-size: 14px !important; box-shadow: 2px 2px 5px rgba(0,0,0,0.2) !important; }
        #extract-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex; justify-content: center; align-items: center; }
        #extract-modal-content { background-color: #fff; padding: 25px; border-radius: 8px; width: 80%; max-width: 700px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        #extract-modal-content h2 { margin-top: 0; margin-bottom: 15px; font-size: 1.5em; color: #333; }
        #extract-modal-textarea { width: 98%; margin-bottom: 15px; font-family: monospace; font-size: 13px; border: 1px solid #ccc; padding: 10px; resize: vertical; flex-grow: 1; min-height: 300px; }
        #extract-modal-buttons { text-align: right; flex-shrink: 0; }
        #extract-modal-buttons button { padding: 8px 12px; margin-left: 10px; border: none; border-radius: 4px; cursor: pointer; }
        #extract-copy-button { background-color: #28a745; color: white; }
        #extract-copy-button:hover { background-color: #218838; }
        #extract-close-button { background-color: #6c757d; color: white; }
        #extract-close-button:hover { background-color: #5a6268; }
    `);

    // --- Functions ---

    /**
     * Converts a MathML string to LaTeX using the loaded library (v1.3.0).
     * Uses the correct path MathMLToLaTeX.MathMLToLaTeX.convert().
     * @param {string} mathmlString - The raw MathML string from data-mathml.
     * @returns {string|null} - LaTeX string on success, null on failure.
     */
    function convertMathMLToLaTeX(mathmlString) {
        if (!mathmlString) {
            console.warn("MathML string is empty.");
            return null;
        }
         // Check if the main library object and the nested convert function exist
        if (typeof MathMLToLaTeX === 'undefined' ||
            typeof MathMLToLaTeX.MathMLToLaTeX === 'undefined' ||
            typeof MathMLToLaTeX.MathMLToLaTeX.convert !== 'function') {
            console.error("MathMLToLaTeX library or convert function not loaded/found correctly.");
            // Try to alert the user only once if the library load failed fundamentally
            if (!window.mathmlLibraryLoadFailed) {
                 alert("エラー：数式変換ライブラリ（MathMLToLaTeX）の読み込みまたは初期化に失敗しました。");
                 window.mathmlLibraryLoadFailed = true; // Prevent repeated alerts
            }
            return null;
        }

        try {
            // *** Use the correct path based on the example ***
            let latex = MathMLToLaTeX.MathMLToLaTeX.convert(mathmlString);
            latex = latex.replace(/^{([^}]*)}$/, '$1'); // Basic cleanup
            return latex.trim();
        } catch (error) {
            console.error("Error converting MathML to LaTeX:", error, "\nMathML:", mathmlString);
            return null;
        }
    }

    // --- extractTextAndFormulas, cleanupExtractedText, getAllQuestionTexts ---
    // --- showModal, createExtractionButton, init functions ---
    // (These functions remain the same as in version 1.6, as the core logic
    // for finding elements, extracting text, handling options, cleaning text,
    // displaying the modal, and placing the button doesn't need to change.
    // The key fix is within convertMathMLToLaTeX.)

     function extractTextAndFormulas(node, processedNodes = new Set()) {
        let text = '';
        if (!node || processedNodes.has(node)) return text;
        
        processedNodes.add(node);

        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const formulaId = node.getAttribute('id') || node.getAttribute('data-mathml');
                if (!processedNodes.has(formulaId)) {
                    processedNodes.add(formulaId);
                    
                    const rawMathML = node.getAttribute('data-mathml');
                    if (rawMathML) {
                        const latexResult = convertMathMLToLaTeX(rawMathML);
                        if (latexResult) {
                            text += LATEX_INLINE_DELIMITER_START + latexResult + LATEX_INLINE_DELIMITER_END;
                        }
                    }
                }
            } else {
                const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD', 'BLOCKQUOTE', 'FIELDSET', 'LEGEND'].includes(node.tagName);
                const isBr = node.tagName === 'BR';

                node.childNodes.forEach(child => {
                    text += extractTextAndFormulas(child, processedNodes);
                });

                if ((isBlock || isBr) && !/\n\s*$/.test(text)) {
                    text += '\n';
                }
            }
        }
        return text;
    }

     function cleanupExtractedText(rawText) {
        if (!rawText) return '';
        let cleaned = rawText
            .replace(/(\$\s*)/g, '$')
            .replace(/(\s*\$)/g, '$')
            .replace(/\s+/g, ' ')
            .replace(/ \n/g, '\n')
            .replace(/\n /g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return cleaned;
     }

    function getAllQuestionTexts() {
        const questionElements = document.querySelectorAll(QUESTION_SELECTOR);
        let allTexts = [];

        // Check library status at the beginning of extraction attempt
         if (typeof MathMLToLaTeX === 'undefined' || typeof MathMLToLaTeX.MathMLToLaTeX === 'undefined' || typeof MathMLToLaTeX.MathMLToLaTeX.convert !== 'function') {
             console.error("MathMLToLaTeX library not ready. Aborting extraction.");
             // Alert is handled inside convertMathMLToLaTeX if it fails per-formula
             return "エラー：数式変換ライブラリが利用できません。"; // Return error message
         }

        questionElements.forEach((qElement, index) => {
            const questionInfoEl = qElement.querySelector('.info .no');
            const textContainerEl = qElement.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
            const formulationEl = qElement.querySelector(FORMULATION_SELECTOR);

            const qNumberText = qElement.querySelector('.qno')?.textContent?.trim() ?? `${index + 1}`;
            const questionTitle = questionInfoEl ? cleanupExtractedText(questionInfoEl.textContent) : `問題 ${qNumberText}`;

            let mainQuestionText = '';
            let questionTextElement = textContainerEl || formulationEl;
            if (questionTextElement) {
                let rawText = extractTextAndFormulas(questionTextElement);
                mainQuestionText = cleanupExtractedText(rawText);
            } else {
                 const contentEl = qElement.querySelector('.content');
                 if(contentEl) {
                     let rawText = extractTextAndFormulas(contentEl);
                     mainQuestionText = cleanupExtractedText(rawText);
                 } else {
                     mainQuestionText = "[問題テキストが見つかりません]";
                 }
            }
            if (mainQuestionText.startsWith(questionTitle)) {
                 mainQuestionText = mainQuestionText.substring(questionTitle.length).trim();
            }

            let optionsOutputText = '';
            const answerElement = qElement.querySelector(ANSWER_BLOCK_SELECTOR);
            if (answerElement) {
                const optionLabelElements = answerElement.querySelectorAll(OPTION_LABEL_SELECTOR);
                if (optionLabelElements.length > 0) {
                    let extractedOptions = [];
                    optionLabelElements.forEach(labelEl => {
                        let rawOptionText = extractTextAndFormulas(labelEl);
                        let cleanedOptionText = cleanupExtractedText(rawOptionText);
                        if (cleanedOptionText) {
                            extractedOptions.push(`- ${cleanedOptionText}`);
                        }
                    });
                    if (extractedOptions.length > 0) {
                         optionsOutputText = OPTIONS_HEADER + "\n" + extractedOptions.join("\n");
                    }
                }
            }

            let fullQuestionText = `${questionTitle}:\n${mainQuestionText}${optionsOutputText}`;
            allTexts.push(fullQuestionText);
        });

        return allTexts.join(TEXT_SEPARATOR);
    }

    function showModal(text) {
        const existingModal = document.getElementById('extract-modal-overlay');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div'); overlay.id = 'extract-modal-overlay';
        const modalContent = document.createElement('div'); modalContent.id = 'extract-modal-content';
        const title = document.createElement('h2'); title.textContent = MODAL_TITLE;
        const textArea = document.createElement('textarea'); textArea.id = 'extract-modal-textarea'; textArea.value = text; textArea.readOnly = true;
        const buttonContainer = document.createElement('div'); buttonContainer.id = 'extract-modal-buttons';
        const copyButton = document.createElement('button'); copyButton.id = 'extract-copy-button'; copyButton.textContent = 'コピー';
        copyButton.onclick = () => { GM_setClipboard(text); copyButton.textContent = 'コピー完了!'; copyButton.disabled = true; setTimeout(() => { copyButton.textContent = 'コピー'; copyButton.disabled = false; }, 2000); };
        const closeButton = document.createElement('button'); closeButton.id = 'extract-close-button'; closeButton.textContent = '閉じる';
        closeButton.onclick = () => { overlay.remove(); };

        buttonContainer.appendChild(copyButton); buttonContainer.appendChild(closeButton);
        modalContent.appendChild(title); modalContent.appendChild(textArea); modalContent.appendChild(buttonContainer);
        overlay.appendChild(modalContent);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        textArea.select();
    }

    function createExtractionButton() {
        if (document.getElementById('extract-questions-button')) return;

        const button = document.createElement('button');
        button.id = 'extract-questions-button';
        button.textContent = BUTTON_TEXT;
        button.type = 'button';
        button.onclick = () => {
            console.log("Extracting questions and options (LaTeX v1.3.0 priority)...");
            // Library check is now also inside getAllQuestionTexts / convertMathMLToLaTeX
            try {
                const extractedText = getAllQuestionTexts();
                if (extractedText.startsWith("エラー：")) { // Check if extraction aborted due to library issue
                    console.error("Extraction aborted:", extractedText);
                    // Optionally show the error in the modal or alert again
                    // showModal(extractedText);
                } else {
                    console.log(`Extraction complete. Text length: ${extractedText.length}`);
                    showModal(extractedText);
                }
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction process:", error);
                alert("問題と選択肢の抽出中に予期せぬエラーが発生しました。コンソールを確認してください。");
            }
        };

        const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
        if (targetContainer) {
            targetContainer.appendChild(button);
            console.log("Moodle Extractor (LaTeX v1.3+Options) button added to header.");
        } else {
            console.warn("Moodle Extractor: Header container not found. Using fallback button.");
            button.classList.add('extract-questions-button-fallback');
            document.body.appendChild(button);
        }
    }

     function init() {
         // Increased delay to allow more time for @require script loading potentially
        setTimeout(createExtractionButton, 1000); // 1 second delay
    }

    // Add a flag to prevent repeated library load failure alerts
    window.mathmlLibraryLoadFailed = false;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
