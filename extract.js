// ==UserScript==
// @name         Moodle Extractor for LLM
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Extracts all question text (including formula alt text) from Moodle.
// @author       civilix
// @match        *://*/mod/quiz/attempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/attempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/processattempt.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moodle.org
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @license      MIT
// ==/UserScript==

/* global MathMLToLaTeX */ // Inform JSHint/ESLint that MathMLToLaTeX is globally available via @require

(function() {
    'use strict';

    // --- Configuration ---
    const BUTTON_TEXT = "問題を抽出 (LaTeX)"; // Updated button text
    const MODAL_TITLE = "抽出された問題と選択肢 (LaTeX)"; // Updated modal title
    const QUESTION_SELECTOR = "div.que";
    const QUESTION_NUMBER_SELECTOR = ".qno";
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext";
    const FORMULATION_SELECTOR = ".formulation";
    const ANSWER_BLOCK_SELECTOR = ".ablock .answer";
    const OPTION_LABEL_SELECTOR = "div[data-region='answer-label'], .r0 > label, .r1 > label"; // Added label selector as fallback for options
    const FORMULA_IMG_SELECTOR = "img.Wirisformula";
    const TEXT_SEPARATOR = "\n\n---\n\n";
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']";
    const OPTIONS_HEADER = "\n\n選択肢:";
    const LATEX_INLINE_DELIMITER_START = " $"; // Start delimiter for LaTeX (with leading space)
    const LATEX_INLINE_DELIMITER_END = "$ ";   // End delimiter for LaTeX (with trailing space)

    // --- Styles --- (Same as v1.5)
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

    // No longer needed cleanMathML, library handles conversion
    // function cleanMathML(mathmlString) { ... }

    /**
     * Converts a MathML string to LaTeX using the loaded library.
     * @param {string} mathmlString - The raw MathML string from data-mathml.
     * @returns {string|null} - LaTeX string on success, null on failure.
     */
    function convertMathMLToLaTeX(mathmlString) {
        if (!mathmlString || typeof MathMLToLaTeX === 'undefined') {
            console.warn("MathML string missing or MathMLToLaTeX library not loaded.");
            return null;
        }
        try {
            // The library might expose the function differently, adjust if needed
            // Common patterns: MathMLToLaTeX.convert() or simply mathmlToLatex()
            // Based on the bundle structure, it likely exposes MathMLToLaTeX global object
            let latex = MathMLToLaTeX.convert(mathmlString);
            // Basic cleanup, remove potential unnecessary {} wrappers if library adds them
             latex = latex.replace(/^{([^}]*)}$/, '$1');
            return latex.trim(); // Trim whitespace from LaTeX result
        } catch (error) {
            console.error("Error converting MathML to LaTeX:", error, "\nMathML:", mathmlString);
            return null; // Indicate failure
        }
    }

    /**
     * Extracts text, converting formulas to LaTeX using MathML data.
     */
    function extractTextAndFormulas(node) {
        let text = '';
        if (!node) return text;

        if (node.nodeType === Node.TEXT_NODE) {
            let content = node.textContent;
            text += content;
            // Add space if needed for separation (will be cleaned later)
            // if (content.trim() && !/\s$/.test(content)) {
            //     text += ' ';
            // }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Handle formula images
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const rawMathML = node.getAttribute('data-mathml');
                const altText = node.getAttribute('alt');
                let formulaOutput = '';

                if (rawMathML) {
                    const latexResult = convertMathMLToLaTeX(rawMathML);
                    if (latexResult) {
                        // Successfully converted to LaTeX
                        formulaOutput = LATEX_INLINE_DELIMITER_START + latexResult + LATEX_INLINE_DELIMITER_END;
                    } else {
                        // Conversion failed, use alt text as fallback
                        formulaOutput = ` [Formula Alt Text: ${altText || 'N/A'}] `;
                         console.warn("MathML to LaTeX conversion failed, using Alt text for:", rawMathML);
                    }
                } else if (altText) {
                    // No MathML, use alt text
                    formulaOutput = ` [Formula Alt Text: ${altText}] `;
                } else {
                    // Nothing available
                    formulaOutput = ' [Formula Image - No Data] ';
                }
                text += formulaOutput;

            } else {
                // Recursively process other elements
                const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD', 'BLOCKQUOTE', 'FIELDSET', 'LEGEND'].includes(node.tagName);
                const isBr = node.tagName === 'BR';

                node.childNodes.forEach(child => {
                    text += extractTextAndFormulas(child);
                });

                 // Add newline AFTER block element or BR for structure (will be cleaned later)
                 if ((isBlock || isBr) && !/\n\s*$/.test(text)) {
                     text += '\n';
                 }
            }
        }
        return text;
    }

    /**
     * Cleans up extracted text: normalizes whitespace, trims.
     */
     function cleanupExtractedText(rawText) {
        if (!rawText) return '';
        // More aggressive whitespace cleanup BETWEEN words/formulas, but keep structure newlines
        let cleaned = rawText
            .replace(/(\$\s*)/g, '$') // Remove space after $ start delimiter
            .replace(/(\s*\$)/g, '$') // Remove space before $ end delimiter
            .replace(/\s+/g, ' ')          // Consolidate mid-text whitespace
            .replace(/ \n/g, '\n')         // Remove space before newline
            .replace(/\n /g, '\n')         // Remove space after newline
            .replace(/\n{3,}/g, '\n\n')    // Reduce multiple newlines to max 2
            .trim();
        return cleaned;
     }


    /**
     * Finds all questions, extracts text and options, then formats.
     */
    function getAllQuestionTexts() {
        const questionElements = document.querySelectorAll(QUESTION_SELECTOR);
        let allTexts = [];

        if (typeof MathMLToLaTeX === 'undefined') {
             console.error("MathMLToLaTeX library not loaded. Cannot convert formulas.");
             alert("Error: Formula conversion library (MathMLToLaTeX) failed to load. Check browser console.");
             // Optional: proceed without conversion?
             // return "Error: MathMLToLaTeX library failed to load.";
        }


        questionElements.forEach((qElement, index) => {
            const questionInfoEl = qElement.querySelector('.info .no');
            const textContainerEl = qElement.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
            const formulationEl = qElement.querySelector(FORMULATION_SELECTOR);

            const qNumberText = qElement.querySelector('.qno')?.textContent?.trim() ?? `${index + 1}`;
            const questionTitle = questionInfoEl ? cleanupExtractedText(questionInfoEl.textContent) : `問題 ${qNumberText}`;

            // Extract Main Question Text
            let mainQuestionText = '';
            let questionTextElement = textContainerEl || formulationEl;
            if (questionTextElement) {
                let rawText = extractTextAndFormulas(questionTextElement); // Use the new extraction function
                mainQuestionText = cleanupExtractedText(rawText);
            } else {
                 const contentEl = qElement.querySelector('.content');
                 if(contentEl) {
                     // Try extracting from '.content' if '.qtext' or '.formulation' are missing
                     let rawText = extractTextAndFormulas(contentEl);
                     mainQuestionText = cleanupExtractedText(rawText);
                 } else {
                     mainQuestionText = "[問題テキストが見つかりません]";
                 }
            }
             // Remove redundant title if extracted within the text element
            if (mainQuestionText.startsWith(questionTitle)) {
                 mainQuestionText = mainQuestionText.substring(questionTitle.length).trim();
            }

            // Extract Options
            let optionsOutputText = '';
            const answerElement = qElement.querySelector(ANSWER_BLOCK_SELECTOR);
            if (answerElement) {
                // Use the combined selector for option labels
                const optionLabelElements = answerElement.querySelectorAll(OPTION_LABEL_SELECTOR);
                if (optionLabelElements.length > 0) {
                    let extractedOptions = [];
                    optionLabelElements.forEach(labelEl => {
                        let rawOptionText = extractTextAndFormulas(labelEl); // Extract option text with formulas
                        let cleanedOptionText = cleanupExtractedText(rawOptionText);
                        if (cleanedOptionText) {
                             // Prefix with a list marker (e.g., "- ")
                            extractedOptions.push(`- ${cleanedOptionText}`);
                        }
                    });
                    if (extractedOptions.length > 0) {
                         optionsOutputText = OPTIONS_HEADER + "\n" + extractedOptions.join("\n");
                    }
                }
                 else {
                     // If no option labels found, check if the answer block itself contains text (e.g., for fill-in-the-blanks help text)
                     let answerBlockText = cleanupExtractedText(extractTextAndFormulas(answerElement));
                     // Avoid adding just input field related noise
                     if (answerBlockText && !answerBlockText.toLowerCase().includes('answer:')) {
                        // Maybe add context? Like "Answer Area Text:"
                        // optionsOutputText = "\n\n回答欄情報:\n" + answerBlockText;
                     }
                 }
            }

            // Combine Title, Main Text, and Options
            let fullQuestionText = `${questionTitle}:\n${mainQuestionText}${optionsOutputText}`;
            allTexts.push(fullQuestionText);
        });

        return allTexts.join(TEXT_SEPARATOR);
    }


    // --- showModal, createExtractionButton, init functions (mostly unchanged) ---

    function showModal(text) {
        // ... (Modal creation code as in v1.5, uses MODAL_TITLE) ...
         const existingModal = document.getElementById('extract-modal-overlay');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div'); overlay.id = 'extract-modal-overlay';
        const modalContent = document.createElement('div'); modalContent.id = 'extract-modal-content';
        const title = document.createElement('h2'); title.textContent = MODAL_TITLE; // Use updated title
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
        button.textContent = BUTTON_TEXT; // Use updated text
        button.type = 'button';
        button.onclick = () => {
            console.log("Extracting questions and options (LaTeX priority)...");
             // Check if library loaded before attempting extraction
            if (typeof MathMLToLaTeX === 'undefined') {
                 alert("エラー：数式変換ライブラリ（MathMLToLaTeX）の読み込みに失敗しました。");
                 console.error("MathMLToLaTeX library is not defined. Aborting extraction.");
                 return; // Stop the process
             }
            try {
                const extractedText = getAllQuestionTexts();
                console.log(`Extraction complete. Text length: ${extractedText.length}`);
                // console.log("Sample Text:\n", extractedText.substring(0, 500)); // Log beginning of text for debugging
                showModal(extractedText);
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction:", error);
                alert("問題と選択肢の抽出中にエラーが発生しました。コンソールを確認してください。");
            }
        };

        // ... (Button placement logic remains the same) ...
         const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
        if (targetContainer) {
            targetContainer.appendChild(button);
            console.log("Moodle Extractor (LaTeX+Options) button added to header.");
        } else {
            console.warn("Moodle Extractor: Header container not found. Using fallback button.");
            button.classList.add('extract-questions-button-fallback');
            document.body.appendChild(button);
        }
    }

    function init() {
        // Wait a bit for elements and potentially the @require script to load fully
        setTimeout(createExtractionButton, 700); // Increased delay slightly
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();