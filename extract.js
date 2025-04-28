// ==UserScript==
// @name         Moodle Extractor for LLM (LaTeX Output)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Extracts question text from Moodle, converting MathML formulas to LaTeX.
// @author       civilix
// @match        *://*/mod/quiz/attempt.php*
// @match        *://*/mod/quiz/processattempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/attempt.php*
// @match        *://wsdmoodle.waseda.jp/mod/quiz/processattempt.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moodle.org
// @require      https://cdn.jsdelivr.net/npm/mathml-to-latex@1.3.0/dist/bundle.min.js
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const BUTTON_TEXT = "問題と選択肢を抽出 (LaTeX)"; // Updated button text
    const MODAL_TITLE = "抽出された問題と選択肢 (LaTeX)"; // Updated modal title
    const QUESTION_SELECTOR = "div.que"; // Main container for each question
    const QUESTION_NUMBER_SELECTOR = ".qno"; // Question number within '.info .no' usually
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext"; // Main question text container
    const FORMULATION_SELECTOR = ".formulation"; // Alternative/broader question container
    const ANSWER_BLOCK_SELECTOR = ".ablock .answer"; // Container for answer options/inputs
    const OPTION_LABEL_SELECTOR = "div[data-region='answer-label']"; // Selector for the div containing the text of an option
    const FORMULA_IMG_SELECTOR = "img.Wirisformula[data-mathml]"; // Formula image selector (must have data-mathml)
    const TEXT_SEPARATOR = "\n\n---\n\n";
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']";
    const OPTIONS_HEADER = "\n\n選択肢:"; // Header text before listing options
    const LATEX_DELIMITER = '$'; // Use '$...$' for inline LaTeX

    // --- Styles --- (Styles remain the same as v1.5)
    GM_addStyle(`
        #extract-questions-button {
            margin-left: 8px; padding: 5px 10px; background-color: #007bff;
            color: white; border: none; border-radius: 5px; cursor: pointer;
            font-size: 13px; box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
            display: inline-block; vertical-align: middle;
        }
        #extract-questions-button:hover { background-color: #0056b3; }
        .extract-questions-button-fallback {
            position: fixed !important; bottom: 20px !important; right: 20px !important;
            z-index: 9999 !important; padding: 10px 15px !important; font-size: 14px !important;
            box-shadow: 2px 2px 5px rgba(0,0,0,0.2) !important;
        }
        #extract-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex;
            justify-content: center; align-items: center;
        }
        #extract-modal-content {
            background-color: #fff; padding: 25px; border-radius: 8px; width: 80%;
            max-width: 700px; max-height: 80vh; display: flex; flex-direction: column;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        #extract-modal-content h2 { margin-top: 0; margin-bottom: 15px; font-size: 1.5em; color: #333; }
        #extract-modal-textarea {
            width: 98%; margin-bottom: 15px; font-family: monospace; font-size: 13px;
            border: 1px solid #ccc; padding: 10px; resize: vertical; flex-grow: 1; min-height: 300px;
        }
        #extract-modal-buttons { text-align: right; flex-shrink: 0; }
        #extract-modal-buttons button {
            padding: 8px 12px; margin-left: 10px; border: none; border-radius: 4px; cursor: pointer;
        }
        #extract-copy-button { background-color: #28a745; color: white; }
        #extract-copy-button:hover { background-color: #218838; }
        #extract-close-button { background-color: #6c757d; color: white; }
        #extract-close-button:hover { background-color: #5a6268; }
    `);


    // --- Functions ---

    /**
     * Cleans MathML string by replacing specific encoded characters.
     * Needed before passing to the converter library.
     */
    function cleanMathML(mathmlString) {
        if (!mathmlString) return '';
        // The library might handle these, but cleaning doesn't hurt
        return mathmlString.replace(/¨/g, '"').replace(/«/g, '<').replace(/»/g, '>');
    }

    /**
     * Converts a MathML string to LaTeX using the loaded library.
     * Includes error handling.
     */
    function convertMathMLToLaTeX(mathmlString) {
        if (!mathmlString) return null;
        try {
            // Ensure the global object from @require is available
            if (typeof MathMLToLaTeX === 'undefined' || typeof MathMLToLaTeX.MathMLToLaTeX === 'undefined' || typeof MathMLToLaTeX.MathMLToLaTeX.convert !== 'function') {
                 console.error("Moodle Extractor: MathMLToLaTeX library not loaded correctly!");
                 return `[MathMLToLaTeX Library Error]`;
            }
            const latex = MathMLToLaTeX.MathMLToLaTeX.convert(mathmlString);
            return latex;
        } catch (e) {
            console.warn("Moodle Extractor: MathML to LaTeX conversion failed:", e, "\nMathML was:", mathmlString);
            return `[Conversion Error: ${e.message}]`; // Return error message instead of original MathML
        }
    }

    /**
     * Extracts text content from a node, converting formulas to LaTeX.
     * Handles text nodes, formula images, and recursively processes child nodes.
     */
    function extractTextWithFormulas(node) {
        let text = '';
        if (!node) return text;

        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent; // Append text content directly
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const rawMathML = node.getAttribute('data-mathml');
                const cleanedMathML = cleanMathML(rawMathML);
                const altText = node.getAttribute('alt');

                if (cleanedMathML) {
                    const latex = convertMathMLToLaTeX(cleanedMathML);
                    if (latex && !latex.startsWith('[Conversion Error:') && !latex.startsWith('[MathMLToLaTeX Library Error]')) {
                        text += ` ${LATEX_DELIMITER}${latex}${LATEX_DELIMITER} `; // Add delimiters and padding
                    } else if (latex) { // Handle conversion error message
                         text += ` ${latex} `;
                    } else if (altText) { // Fallback 1: Use alt text if conversion failed unexpectedly or MathML was empty
                        text += ` [Formula Alt Text: ${altText}] `;
                    } else { // Fallback 2: Generic placeholder
                        text += ' [Formula Error - Check Console] ';
                    }
                } else if (altText) { // If no MathML, use alt text
                    text += ` [Formula Alt Text: ${altText}] `;
                } else { // If no MathML and no alt text
                    text += ' [Formula Image - No Data] ';
                }
            } else {
                // Handle block elements for potential line breaks (simplified)
                const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD', 'BLOCKQUOTE', 'FIELDSET', 'LEGEND', 'UL', 'OL', 'TABLE'].includes(node.tagName);
                const isBr = node.tagName === 'BR';

                // Recursively process child nodes
                node.childNodes.forEach(child => {
                    text += extractTextWithFormulas(child);
                });

                 // Add newline AFTER block elements or BR for basic structure
                 if (isBlock || isBr) {
                      // Append newline if not already ending with significant whitespace
                      if (!/\s\s$/.test(text)) {
                          text += '\n';
                      }
                 }
            }
        }
        return text;
    }

    /**
     * Cleans up the fully extracted text block for better readability.
     * Normalizes whitespace, trims.
     */
     function cleanupExtractedText(rawText) {
         if (!rawText) return '';
         // 1. Replace various whitespace chars (like non-breaking space) with normal space
         let cleaned = rawText.replace(/[\s\u00A0]+/g, ' ');
         // 2. Add space before $ if preceded by non-space/non-$ and not start of line
         cleaned = cleaned.replace(/([^\s$])\$/g, '$1 $');
         // 3. Add space after $ if followed by non-space/non-$ and not end of line
         cleaned = cleaned.replace(/\$([^\s$])/g, '$ $1');
         // 4. Normalize newlines and spaces around them
         cleaned = cleaned.replace(/ *\n */g, '\n'); // Remove spaces around newlines
         // 5. Reduce multiple newlines to a maximum of two
         cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
         // 6. Trim leading/trailing whitespace/newlines
         return cleaned.trim();
     }


    /**
     * Finds all questions, extracts text (converting formulas to LaTeX) and options, then formats.
     */
    function getAllQuestionTexts() {
        const questionElements = document.querySelectorAll(QUESTION_SELECTOR);
        let allTexts = [];

        questionElements.forEach((qElement, index) => {
            const numberEl = qElement.querySelector(QUESTION_NUMBER_SELECTOR);
            const questionInfoEl = qElement.querySelector('.info .no'); // Includes number and potentially "問題" text
            const textContainerEl = qElement.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
            const formulationEl = qElement.querySelector(FORMULATION_SELECTOR); // Broader container for question

            // Determine Question Title/Number
            const qNumber = numberEl ? numberEl.textContent.trim() : `${index + 1}`;
            // Clean the title *after* extraction to handle potential formulas within it
            const rawQuestionTitle = questionInfoEl ? extractTextWithFormulas(questionInfoEl) : `問題 ${qNumber}`;
            const questionTitle = cleanupExtractedText(rawQuestionTitle);


            // Extract Main Question Text
            let mainQuestionText = '';
            let questionTextElement = textContainerEl || formulationEl; // Prefer .qtext, fallback to .formulation
            if (questionTextElement) {
                 let rawText = extractTextWithFormulas(questionTextElement);
                 mainQuestionText = cleanupExtractedText(rawText);
            } else {
                 // Fallback for description type questions etc.
                 const contentEl = qElement.querySelector('.content');
                 if(contentEl) {
                     let rawText = extractTextWithFormulas(contentEl);
                     mainQuestionText = cleanupExtractedText(rawText);
                 } else {
                     mainQuestionText = "[問題テキストが見つかりません]";
                 }
            }

            // Sometimes the title is part of the formulation/qtext, remove if necessary
            if (mainQuestionText.startsWith(questionTitle + ':')) { // Check with colon added by cleanup potentially
                 mainQuestionText = mainQuestionText.substring(questionTitle.length + 1).trim();
            } else if (mainQuestionText.startsWith(questionTitle)) {
                 mainQuestionText = mainQuestionText.substring(questionTitle.length).trim();
            }


            // Extract Options
            let optionsOutputText = '';
            const answerElement = qElement.querySelector(ANSWER_BLOCK_SELECTOR);
            if (answerElement) {
                const optionLabelElements = answerElement.querySelectorAll(OPTION_LABEL_SELECTOR);
                if (optionLabelElements.length > 0) {
                    let extractedOptions = [];
                    optionLabelElements.forEach(labelEl => {
                        let rawOptionText = extractTextWithFormulas(labelEl);
                        let cleanedOptionText = cleanupExtractedText(rawOptionText);
                        if (cleanedOptionText) {
                            extractedOptions.push(`- ${cleanedOptionText}`); // Prefix with "- "
                        }
                    });
                    if (extractedOptions.length > 0) {
                         optionsOutputText = OPTIONS_HEADER + "\n" + extractedOptions.join("\n");
                    }
                }
            }

            // Combine Title, Main Text, and Options
            // Ensure there's a newline between title and text if text isn't empty
            let fullQuestionText = questionTitle + (mainQuestionText ? `\n${mainQuestionText}` : '') + optionsOutputText;
            allTexts.push(fullQuestionText);
        });

        // Join all questions with separator
        return allTexts.join(TEXT_SEPARATOR);
    }


    /**
     * Shows the modal dialog with the extracted text.
     */
    function showModal(text) {
        // Remove existing modal if present
        const existingModal = document.getElementById('extract-modal-overlay');
        if (existingModal) existingModal.remove();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'extract-modal-overlay';
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) { // Close only if clicking the overlay itself
                overlay.remove();
            }
        });

        // Create modal content container
        const modalContent = document.createElement('div');
        modalContent.id = 'extract-modal-content';

        // Create title
        const title = document.createElement('h2');
        title.textContent = MODAL_TITLE; // Use updated title

        // Create text area
        const textArea = document.createElement('textarea');
        textArea.id = 'extract-modal-textarea';
        textArea.value = text;
        textArea.readOnly = true;

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'extract-modal-buttons';

        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.id = 'extract-copy-button';
        copyButton.textContent = 'コピー';
        copyButton.onclick = () => {
            GM_setClipboard(text);
            copyButton.textContent = 'コピー完了!';
            copyButton.disabled = true;
            setTimeout(() => {
                copyButton.textContent = 'コピー';
                copyButton.disabled = false;
            }, 2000);
        };

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.id = 'extract-close-button';
        closeButton.textContent = '閉じる';
        closeButton.onclick = () => {
            overlay.remove();
        };

        // Assemble modal
        buttonContainer.appendChild(copyButton);
        buttonContainer.appendChild(closeButton);
        modalContent.appendChild(title);
        modalContent.appendChild(textArea);
        modalContent.appendChild(buttonContainer);
        overlay.appendChild(modalContent);

        // Add to page and focus textarea
        document.body.appendChild(overlay);
        textArea.select(); // Select text for easy copying
    }

    /**
     * Creates the extraction button and adds it to the page.
     */
    function createExtractionButton() {
        // Avoid creating duplicate buttons
        if (document.getElementById('extract-questions-button')) return;

        const button = document.createElement('button');
        button.id = 'extract-questions-button';
        button.textContent = BUTTON_TEXT; // Use updated text
        button.type = 'button'; // Good practice for buttons not submitting forms

        button.onclick = () => {
            console.log("Moodle Extractor: Starting extraction (MathML to LaTeX)...");
            try {
                 // Check if library loaded before attempting extraction
                if (typeof MathMLToLaTeX === 'undefined' || typeof MathMLToLaTeX.MathMLToLaTeX === 'undefined') {
                     alert("エラー: MathML-to-LaTeX ライブラリが正しく読み込まれませんでした。ページを再読み込みするか、スクリプトの @require ディレクティブを確認してください。");
                     console.error("Moodle Extractor: MathMLToLaTeX library object not found.");
                     return; // Stop execution
                }

                const extractedText = getAllQuestionTexts();
                console.log(`Moodle Extractor: Extraction complete. Text length: ${extractedText.length}`);
                 if (!extractedText.trim()) {
                    console.warn("Moodle Extractor: No questions found or extracted text is empty.");
                    alert("問題が見つからなかったか、抽出されたテキストが空です。");
                 } else {
                    showModal(extractedText);
                 }
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction process:", error);
                alert("問題と選択肢の抽出中にエラーが発生しました。詳細はブラウザのコンソールを確認してください。");
            }
        };

        // Try to add button to the header actions container
        const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
        if (targetContainer) {
            targetContainer.appendChild(button);
            console.log("Moodle Extractor (LaTeX) button added to header.");
        } else {
            // Fallback: Add button as a fixed element if the header container isn't found
            console.warn("Moodle Extractor: Header container not found. Using fallback button position.");
            button.classList.add('extract-questions-button-fallback');
            document.body.appendChild(button);
        }
    }

    /**
     * Initializes the script, waiting briefly for dynamic content.
     */
    function init() {
        // Use a timeout to wait for Moodle's dynamic elements (like the header) to potentially load
        // Adjust delay if necessary (e.g., if button doesn't appear consistently)
        console.log("Moodle Extractor (LaTeX): Initializing...");
        setTimeout(createExtractionButton, 1000); // Increased delay slightly to 1s
    }

     // --- Script Execution ---
     // Run init() either after DOM is loaded or immediately if already loaded.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init(); // DOM is already ready
    }

})();