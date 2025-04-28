// ==UserScript==
// @name         Moodle Extractor for LLM
// @namespace    http://tampermonkey.net/
// @version      1.4
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
    const BUTTON_TEXT = "問題を抽出 (MathML)"; // Indicate MathML extraction
    const MODAL_TITLE = "抽出された問題テキスト (MathML)";
    const QUESTION_SELECTOR = "div.que";
    const QUESTION_NUMBER_SELECTOR = ".qno";
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext";
    const FORMULA_IMG_SELECTOR = "img.Wirisformula";
    const TEXT_SEPARATOR = "\n\n---\n\n";
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']";

    // --- Styles --- (Styles remain the same as version 1.3)
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
        #extract-modal-overlay { /* ... rest of styles unchanged ... */
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
     * Cleans the MathML string extracted from data-mathml attribute.
     * Replaces non-standard quotes and brackets.
     * @param {string} mathmlString - The raw MathML string.
     * @returns {string} - The cleaned MathML string.
     */
    function cleanMathML(mathmlString) {
        if (!mathmlString) return '';
        // Replace non-standard quotes and brackets used by Wiris/Moodle
        return mathmlString.replace(/¨/g, '"').replace(/«/g, '<').replace(/»/g, '>');
    }

    /**
     * Recursively extracts text content, replacing formula images with cleaned MathML
     * or fallback alt text.
     * @param {Node} node - The current HTML node.
     * @returns {string} - The extracted text.
     */
    function extractTextWithFormulas(node) {
        let text = '';
        if (!node) return text;

        if (node.nodeType === Node.TEXT_NODE) {
            // Append trimmed text node content, adding a space if it's not just whitespace
            const trimmedText = node.textContent.trim();
            if (trimmedText) {
                text += node.textContent + ' '; // Preserve original spacing within text nodes, add trailing space
            } else {
                 text += node.textContent; // Append whitespace nodes as they might be intentional
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Handle formula images specifically
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const rawMathML = node.getAttribute('data-mathml');
                const cleanedMathML = cleanMathML(rawMathML);
                const altText = node.getAttribute('alt');

                if (cleanedMathML) {
                    // Prioritize cleaned MathML
                    text += ` ${cleanedMathML} `; // Add spacing around the MathML block
                } else if (altText) {
                    // Fallback to alt text if MathML is missing
                    text += ` [Formula Alt Text: ${altText}] `; // Indicate it's fallback text
                } else {
                    text += ' [Formula Image - No Data] '; // Placeholder if neither is available
                }
            } else {
                // For other elements, process children and handle block elements
                const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD', 'BLOCKQUOTE'].includes(node.tagName);
                const isBr = node.tagName === 'BR';

                 // Add newline *before* starting a new block element if the preceding text doesn't end with whitespace.
                 if (isBlock && text.length > 0 && !/\s$/.test(text)) {
                    // text += '\n'; // Add newline before block
                 }

                // Recursively process child nodes
                node.childNodes.forEach(child => {
                    text += extractTextWithFormulas(child);
                });

                 // Add newline *after* block elements or BR tags
                 if (isBlock && !isBr) {
                     if (!/\n\s*$/.test(text)) { // Add newline if not already ending with one
                        text += '\n';
                     }
                 } else if (isBr) {
                    if (!/\n\s*$/.test(text)) { // Add newline for BR if not already ending with one
                        text += '\n';
                    }
                 }
            }
        }
        return text;
    }

    /**
     * Finds all questions and extracts their text, cleaning up whitespace.
     * @returns {string} - The formatted text of all questions.
     */
    function getAllQuestionTexts() {
        const questionElements = document.querySelectorAll(QUESTION_SELECTOR);
        let allTexts = [];

        questionElements.forEach((qElement, index) => {
            const numberEl = qElement.querySelector(QUESTION_NUMBER_SELECTOR);
            const textContainerEl = qElement.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
            const formulationEl = qElement.querySelector('.formulation'); // Broader container

            const qNumber = numberEl ? numberEl.textContent.trim() : `${index + 1}`;
            const questionTitleElement = qElement.querySelector('.info .no');
            const questionTitle = questionTitleElement ? questionTitleElement.textContent.replace(/\s+/g, ' ').trim() : `問題 ${qNumber}`;

            let qText = '';
            // Prefer '.qtext', fallback to '.formulation', then the whole question element
            let targetEl = textContainerEl || formulationEl || qElement;

            if (targetEl) {
                // Extract text using the updated function
                 qText = extractTextWithFormulas(targetEl);

                 // Post-processing cleanup for extracted text of a single question
                 qText = qText
                     .replace(/\s+/g, ' ') // Consolidate multiple spaces into one (careful with MathML)
                     .replace(/ </g, '<') // Remove space before opening MathML tag
                     .replace(/> /g, '>') // Remove space after closing MathML tag
                     .replace(/ \n/g, '\n') // Remove space before newline
                     .replace(/\n /g, '\n') // Remove space after newline
                     .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines
                     .trim();

            } else {
                qText = "[問題テキストコンテナが見つかりません]";
            }

            allTexts.push(`${questionTitle}:\n${qText}`);
        });

        // Final cleanup of the joined text
        let combinedText = allTexts.join(TEXT_SEPARATOR);
        return combinedText.replace(/\n{3,}/g, '\n\n').trim(); // Ensure max 2 newlines between blocks
    }


    // --- showModal, createExtractionButton, init functions remain the same as version 1.3 ---
    // (Except for updating button/modal text labels if desired)

    function showModal(text) {
        // ... (Modal creation code is identical to previous version) ...
        // Find existing modal
        const existingModal = document.getElementById('extract-modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal elements
        const overlay = document.createElement('div');
        overlay.id = 'extract-modal-overlay';
        // ... (rest of modal creation)

        const modalContent = document.createElement('div');
        modalContent.id = 'extract-modal-content';

        const title = document.createElement('h2');
        title.textContent = MODAL_TITLE; // Use updated title

        const textArea = document.createElement('textarea');
        textArea.id = 'extract-modal-textarea';
        textArea.value = text;
        textArea.readOnly = true;

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'extract-modal-buttons';

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

        // Close modal if clicking outside
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });

        // Append modal to body
        document.body.appendChild(overlay);
        textArea.select();
    }

    function createExtractionButton() {
        if (document.getElementById('extract-questions-button')) {
            console.log("Moodle Extractor: Button already exists.");
            return;
        }

        const button = document.createElement('button');
        button.id = 'extract-questions-button';
        button.textContent = BUTTON_TEXT; // Use updated text
        button.type = 'button';
        button.onclick = () => {
            console.log("Extracting questions (MathML priority)...");
            try {
                const extractedText = getAllQuestionTexts();
                console.log("Extraction complete. Showing modal.");
                showModal(extractedText);
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction:", error);
                alert("問題の抽出中にエラーが発生しました。コンソールを確認してください。");
            }
        };

        const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);
        if (targetContainer) {
            targetContainer.appendChild(button);
            console.log("Moodle Extractor (MathML) button added to header actions container.");
        } else {
            console.warn("Moodle Extractor: Header action container not found. Using fallback floating button.");
            button.classList.add('extract-questions-button-fallback');
            document.body.appendChild(button);
        }
    }

    function init() {
        requestAnimationFrame(() => {
            createExtractionButton();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();