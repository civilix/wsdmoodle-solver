// ==UserScript==
// @name         Moodle Extractor for LLM
// @namespace    http://tampermonkey.net/
// @version      1.3
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
    const BUTTON_TEXT = "問題を抽出"; // Changed text to Japanese
    const MODAL_TITLE = "抽出された問題テキスト"; // Changed text to Japanese
    const QUESTION_SELECTOR = "div.que";
    const QUESTION_NUMBER_SELECTOR = ".qno";
    const QUESTION_TEXT_CONTAINER_SELECTOR = ".qtext";
    const FORMULA_IMG_SELECTOR = "img.Wirisformula";
    const TEXT_SEPARATOR = "\n\n---\n\n";
    // Selector for the preferred button location (Moodle header action area)
    const HEADER_ACTION_CONTAINER_SELECTOR = "div.header-actions-container[data-region='header-actions-container']"; // More specific selector

    // --- Styles ---
    GM_addStyle(`
        /* Style for the button when placed in the header */
        #extract-questions-button {
            /* Remove fixed positioning */
            /* position: fixed; */
            /* bottom: 20px; */
            /* right: 20px; */
            /* z-index: 9999; */

            /* Add some spacing if needed */
            margin-left: 8px;
            padding: 5px 10px; /* Smaller padding for header */
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 13px; /* Slightly smaller font */
            box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
            display: inline-block; /* Align with other header items */
            vertical-align: middle; /* Align vertically */
        }
        #extract-questions-button:hover {
            background-color: #0056b3;
        }

        /* Fallback style if header container not found (applied via JS) */
        .extract-questions-button-fallback {
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            z-index: 9999 !important;
             padding: 10px 15px !important; /* Restore original padding */
             font-size: 14px !important; /* Restore original font size */
             box-shadow: 2px 2px 5px rgba(0,0,0,0.2) !important;
        }

        /* Modal Styles (unchanged) */
        #extract-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        #extract-modal-content {
            background-color: #fff;
            padding: 25px;
            border-radius: 8px;
            width: 80%;
            max-width: 700px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        #extract-modal-content h2 {
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 1.5em;
            color: #333;
        }
        #extract-modal-textarea {
            width: 98%;
            /* height: 400px; */ /* Let flexbox handle height */
            margin-bottom: 15px;
            font-family: monospace;
            font-size: 13px;
            border: 1px solid #ccc;
            padding: 10px;
            resize: vertical;
            flex-grow: 1; /* Allow textarea to take up space */
            min-height: 300px; /* Ensure minimum height */
        }
        #extract-modal-buttons {
            text-align: right;
            flex-shrink: 0; /* Prevent buttons from shrinking */
        }
        #extract-modal-buttons button {
            padding: 8px 12px;
            margin-left: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        #extract-copy-button {
            background-color: #28a745;
            color: white;
        }
         #extract-copy-button:hover {
            background-color: #218838;
        }
        #extract-close-button {
            background-color: #6c757d; /* Gray close button */
            color: white;
        }
         #extract-close-button:hover {
            background-color: #5a6268;
        }
    `);

    // --- Functions --- (extractTextWithFormulas and getAllQuestionTexts remain the same)

    function extractTextWithFormulas(node) {
        let text = '';
        if (!node) return text;

        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent.trim() ? node.textContent.trim() + ' ' : '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches(FORMULA_IMG_SELECTOR)) {
                const altText = node.getAttribute('alt') || '[数式画像 - 代替テキストなし]'; // Japanese fallback text
                text += ` ${altText} `;
            } else {
                const isBlock = ['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DT', 'DD'].includes(node.tagName);
                 let prefix = '';
                 let suffix = '';

                 if (isBlock && node.tagName !== 'BR') {
                     // Add newline before block elements if the previous text didn't end with one
                     if (text.length > 0 && !/\s\n$/.test(text)) {
                        // prefix = '\n'; // Add newline before starting a new block element if needed
                     }
                     suffix = '\n'; // Add newline after block elements
                 } else if (node.tagName === 'BR') {
                     suffix = '\n'; // Treat BR as newline
                 }


                text += prefix;
                node.childNodes.forEach(child => {
                    text += extractTextWithFormulas(child);
                });
                text += suffix;

            }
        }
        // Clean up excessive whitespace and newlines at the end of processing
        return text.replace(/\s+/g, ' ').replace(/ (\n) /g, '$1').replace(/(\n){2,}/g, '\n\n').trim();
    }


    function getAllQuestionTexts() {
        const questionElements = document.querySelectorAll(QUESTION_SELECTOR);
        let allTexts = [];

        questionElements.forEach((qElement, index) => {
             const numberEl = qElement.querySelector(QUESTION_NUMBER_SELECTOR);
             const textContainerEl = qElement.querySelector(QUESTION_TEXT_CONTAINER_SELECTOR);
             // Also try to get general question info if text container fails
             const formulationEl = qElement.querySelector('.formulation');

             const qNumber = numberEl ? numberEl.textContent.trim() : `${index + 1}`;

             let qText = '';
             let targetEl = textContainerEl || formulationEl || qElement; // Find the best element to extract from

             if (targetEl) {
                 qText = extractTextWithFormulas(targetEl);
             } else {
                 qText = "[問題テキストコンテナが見つかりません]"; // Japanese error text
             }

             const questionTitleElement = qElement.querySelector('.info .no');
             // Clean up "問題 X" to just "問題 X"
             const questionTitle = questionTitleElement ? questionTitleElement.textContent.replace(/\s+/g, ' ').trim() : `問題 ${qNumber}`;

            // Format: Question Title (like "問題 1"): followed by the text
             allTexts.push(`${questionTitle}:\n${qText}`);
        });

        // Final cleanup of the joined text
        let combinedText = allTexts.join(TEXT_SEPARATOR);
        // Reduce sequences of more than two newlines down to two
        combinedText = combinedText.replace(/\n{3,}/g, '\n\n');
        return combinedText.trim();
    }

    function showModal(text) {
        const existingModal = document.getElementById('extract-modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'extract-modal-overlay';

        const modalContent = document.createElement('div');
        modalContent.id = 'extract-modal-content';

        const title = document.createElement('h2');
        title.textContent = MODAL_TITLE;

        const textArea = document.createElement('textarea');
        textArea.id = 'extract-modal-textarea';
        textArea.value = text;
        textArea.readOnly = true;

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'extract-modal-buttons';

        const copyButton = document.createElement('button');
        copyButton.id = 'extract-copy-button';
        copyButton.textContent = 'コピー'; // Japanese text
        copyButton.onclick = () => {
            GM_setClipboard(text);
            copyButton.textContent = 'コピー完了!'; // Japanese text
            copyButton.disabled = true;
            setTimeout(() => {
                 copyButton.textContent = 'コピー'; // Japanese text
                 copyButton.disabled = false;
            }, 2000);
        };

        const closeButton = document.createElement('button');
        closeButton.id = 'extract-close-button';
        closeButton.textContent = '閉じる'; // Japanese text
        closeButton.onclick = () => {
            overlay.remove();
        };

        buttonContainer.appendChild(copyButton);
        buttonContainer.appendChild(closeButton);
        modalContent.appendChild(title);
        modalContent.appendChild(textArea);
        modalContent.appendChild(buttonContainer);
        overlay.appendChild(modalContent);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });

        document.body.appendChild(overlay);
        textArea.select();
    }


    /**
     * Creates the button and attempts to place it in the header.
     * Falls back to fixed positioning if the header location isn't found.
     */
    function createExtractionButton() {
        // Check if button already exists
        if (document.getElementById('extract-questions-button')) {
            console.log("Moodle Extractor: Button already exists.");
            return;
        }

        const button = document.createElement('button');
        button.id = 'extract-questions-button';
        button.textContent = BUTTON_TEXT;
        button.type = 'button'; // Good practice for buttons not submitting forms
        button.onclick = () => {
            console.log("Extracting questions...");
            try {
                const extractedText = getAllQuestionTexts();
                console.log("Extraction complete. Showing modal.");
                showModal(extractedText);
            } catch (error) {
                console.error("Moodle Extractor: Error during extraction:", error);
                alert("問題の抽出中にエラーが発生しました。コンソールを確認してください。"); // Japanese error
            }
        };

        // Try to find the preferred header container
        const targetContainer = document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR);

        if (targetContainer) {
            // Found the header container, append the button there
            targetContainer.appendChild(button);
            console.log("Moodle Extractor button added to header actions container.");
        } else {
            // Header container not found, use fallback fixed positioning
            console.warn("Moodle Extractor: Header action container ('" + HEADER_ACTION_CONTAINER_SELECTOR + "') not found. Using fallback floating button.");
            // Apply fallback styles using a class
             button.classList.add('extract-questions-button-fallback');
             document.body.appendChild(button);
        }
    }

    // --- Initialization ---
    // Use a more robust method than just 'load' for dynamic Moodle pages
    function init() {
        // Wait a short moment for dynamic content to potentially load
        // Use requestAnimationFrame for smoother integration with rendering
        requestAnimationFrame(() => {
             createExtractionButton();
        });

        // Optionally, use MutationObserver if buttons disappear on navigation within Moodle's SPA-like features
        // This is more complex and might be overkill, uncomment if needed
        /*
        const observer = new MutationObserver(mutations => {
            if (!document.getElementById('extract-questions-button')) {
                 // Button removed, maybe due to partial page update, try adding it again
                 createExtractionButton();
            }
            // Optimization: Check if the target header container appeared
            if (!document.getElementById('extract-questions-button') && document.querySelector(HEADER_ACTION_CONTAINER_SELECTOR)) {
                 createExtractionButton();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        */
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init(); // DOM is already ready
    }

})();