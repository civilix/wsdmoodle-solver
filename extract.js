// ==UserScript==
// @name         Moodle Extractor for LLM
// @namespace    http://tampermonkey.net/
// @version      1.5
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

(function() {
    'use strict';

    // --- Configuration ---
    const BUTTON_TEXT = "問題と選択肢を抽出"; // Updated button text
    const MODAL_TITLE = "抽出された問題と選択肢 (MathML)"; // Updated modal title
    const QUESTION_SELECTOR = "div.que"; // Main container for each question
    const QUESTION_NUMBER_SELECTOR = ".qno"; // Question number within '.info .no' usually
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext"; // Main question text container
    const FORMULATION_SELECTOR = ".formulation"; // Alternative/broader question container
    const ANSWER_BLOCK_SELECTOR = ".ablock .answer"; // Container for answer options/inputs
    const OPTION_LABEL_SELECTOR = "div[data-region='answer-label']"; // Selector for the div containing the text of an option
    const FORMULA_IMG_SELECTOR = "img.Wirisformula"; // Formula image selector
    const TEXT_SEPARATOR = "\n\n---\n\n";
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']";
    const OPTIONS_HEADER = "\n\n選択肢:"; // Header text before listing options

    // --- Styles --- (Styles remain the same)
    GM_addStyle(`
        #extract-questions-button { /* ... styles ... */ }
        #extract-questions-button:hover { /* ... styles ... */ }
        .extract-questions-button-fallback { /* ... styles ... */ }
        #extract-modal-overlay { /* ... styles ... */ }
        #extract-modal-content { /* ... styles ... */ }
        #extract-modal-content h2 { /* ... styles ... */ }
        #extract-modal-textarea { /* ... styles ... */ }
        #extract-modal-buttons { /* ... styles ... */ }
        #extract-modal-buttons button { /* ... styles ... */ }
        #extract-copy-button { /* ... styles ... */ }
        #extract-copy-button:hover { /* ... styles ... */ }
        #extract-close-button { /* ... styles ... */ }
        #extract-close-button:hover { /* ... styles ... */ }

        /* --- Keeping styles minimal for brevity, same as v1.4 --- */
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

    function cleanMathML(mathmlString) {
        if (!mathmlString) return '';
        return mathmlString.replace(/¨/g, '"').replace(/«/g, '<').replace(/»/g, '>');
    }

    /**
     * Extracts text, prioritizing MathML for formulas.
     * Now also better handles whitespace around elements.
     */
    function extractTextWithFormulas(node) {
        let text = '';
        if (!node) return text;

        if (node.nodeType === Node.TEXT_NODE) {
            // Preserve whitespace within text nodes, but trim leading/trailing whitespace of the whole node
            // Append a space if the node is not purely whitespace and doesn't already end with space
            let content = node.textContent;
             text += content;
             // Add space after non-empty text node if it doesn't end in whitespace, helps separate words
             if (content.trim() && !/\s$/.test(content)) {
                 text += ' ';
             }

        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const rawMathML = node.getAttribute('data-mathml');
                const cleanedMathML = cleanMathML(rawMathML);
                const altText = node.getAttribute('alt');
                if (cleanedMathML) {
                    text += ` ${cleanedMathML} `; // Space padding
                } else if (altText) {
                    text += ` [Formula Alt Text: ${altText}] `;
                } else {
                    text += ' [Formula Image - No Data] ';
                }
            } else {
                 // Handle block elements for line breaks
                const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD', 'BLOCKQUOTE', 'FIELDSET', 'LEGEND'].includes(node.tagName);
                const isBr = node.tagName === 'BR';

                 // Add newline BEFORE block element if needed (if previous text didn't end with whitespace/newline)
                 if (isBlock && text.length > 0 && !/\s$/.test(text)) {
                    // text += '\n';
                 }

                node.childNodes.forEach(child => {
                    text += extractTextWithFormulas(child);
                });

                 // Add newline AFTER block element or BR
                 if ((isBlock || isBr) && !/\n\s*$/.test(text)) {
                      text += '\n';
                 } else if (!isBlock && !isBr && text.length > 0 && !/\s$/.test(text) && node.nextSibling && node.nextSibling.nodeType === Node.ELEMENT_NODE) {
                     // Add space between adjacent inline elements if needed
                     // text += ' ';
                 }
            }
        }
        return text; // Return raw extracted text, cleanup happens later
    }

    /**
     * Cleans up extracted text: normalizes whitespace, trims, handles MathML spacing.
     */
     function cleanupExtractedText(rawText) {
         if (!rawText) return '';
         return rawText
            .replace(/\s+/g, ' ')          // Consolidate whitespace (careful with intended multi-spaces if any)
            .replace(/ </g, '<')           // Remove space before opening MathML tag
            .replace(/> /g, '>')           // Remove space after closing MathML tag
            .replace(/<math/g, '\n<math')  // Add newline before math block for readability
            .replace(/<\/math>/g, '</math>\n') // Add newline after math block
            .replace(/ \n/g, '\n')         // Remove space before newline
            .replace(/\n /g, '\n')         // Remove space after newline
            .replace(/\n{3,}/g, '\n\n')    // Reduce multiple newlines to max 2
            .trim();                       // Trim leading/trailing whitespace
     }


    /**
     * Finds all questions, extracts text and options, then formats.
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
            const questionTitle = questionInfoEl ? cleanupExtractedText(questionInfoEl.textContent) : `問題 ${qNumber}`;

            // Extract Main Question Text
            let mainQuestionText = '';
            let questionTextElement = textContainerEl || formulationEl; // Prefer .qtext, fallback to .formulation
            if (questionTextElement) {
                // Extract raw text first
                 let rawText = extractTextWithFormulas(questionTextElement);
                 // Clean specific element text right after extraction
                 mainQuestionText = cleanupExtractedText(rawText);
            } else {
                // Sometimes question text is directly in .content, not .qtext (e.g., description type)
                 const contentEl = qElement.querySelector('.content');
                 if(contentEl) {
                     mainQuestionText = cleanupExtractedText(extractTextWithFormulas(contentEl));
                 } else {
                     mainQuestionText = "[問題テキストが見つかりません]";
                 }
            }
            // Remove redundant title if it was included in the formulation extraction
            if (mainQuestionText.startsWith(questionTitle)) {
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
                        // Extract raw text for each option
                        let rawOptionText = extractTextWithFormulas(labelEl);
                        // Clean up each option's text
                        let cleanedOptionText = cleanupExtractedText(rawOptionText);
                        if (cleanedOptionText) { // Only add if text was found
                            extractedOptions.push(`- ${cleanedOptionText}`); // Prefix with "- " for list format
                        }
                    });
                    if (extractedOptions.length > 0) {
                         optionsOutputText = OPTIONS_HEADER + "\n" + extractedOptions.join("\n");
                    }
                }
            }

            // Combine Title, Main Text, and Options
            let fullQuestionText = `${questionTitle}:\n${mainQuestionText}${optionsOutputText}`;
            allTexts.push(fullQuestionText);
        });

        // Join all questions with separator
        return allTexts.join(TEXT_SEPARATOR);
    }


    // --- showModal, createExtractionButton, init functions remain the same as v1.4 ---
    // (Ensure MODAL_TITLE and BUTTON_TEXT are updated where they are used)

    function showModal(text) {
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
            console.log("Extracting questions and options (MathML priority)...");
            try {
                const extractedText = getAllQuestionTexts();
                console.log(`Extraction complete. Text length: ${extractedText.length}`);
                showModal(extractedText);
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction:", error);
                alert("問題と選択肢の抽出中にエラーが発生しました。コンソールを確認してください。");
            }
        };

        const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
        if (targetContainer) {
            targetContainer.appendChild(button);
            console.log("Moodle Extractor (MathML+Options) button added to header.");
        } else {
            console.warn("Moodle Extractor: Header container not found. Using fallback button.");
            button.classList.add('extract-questions-button-fallback');
            document.body.appendChild(button);
        }
    }

    function init() {
        // Delay slightly to allow Moodle's dynamic elements to render
        setTimeout(createExtractionButton, 500); // 500ms delay, adjust if needed
    }

     // Use DOMContentLoaded for initial load, but init() allows calling later if needed
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init(); // DOM is already ready
    }

})();