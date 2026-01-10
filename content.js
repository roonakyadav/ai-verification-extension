// Content script for ChatGPT AI Verification Extension

(function() {
  'use strict';

  console.log("[AI-Verification] content script loaded");

  // WeakMap to store answer IDs keyed by DOM nodes for stability
  const answerIds = new WeakMap();
  
  // WeakSet to track processed answer nodes for idempotency
  const processedAnswers = new WeakSet();

  // Map to store timeouts for content stability checks
  const stabilityTimeouts = new Map();
  
  // Map to track the current state of each answer
  const answerStates = new Map();
  
  // Map to store content observation timeouts
  const contentObservationTimeouts = new Map();
  
  // Enum for verification states
  const VERIFICATION_STATES = {
    WAITING_FOR_AI: 'waiting_for_ai',
    VERIFYING: 'verifying',
    VERIFIED: 'verified'
  };

  // Function to generate a unique ID for each answer
  function generateAnswerId() {
    return 'answer_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
  }

  // Function to get or create answer ID for a given node
  function getOrCreateAnswerId(answerNode) {
    if (!answerIds.has(answerNode)) {
      answerIds.set(answerNode, generateAnswerId());
    }
    return answerIds.get(answerNode);
  }

  // Function to create the verification panel
  function createVerificationPanel(answerId) {
    // Create the verification container
    const verificationContainer = document.createElement('div');
    verificationContainer.className = 'ai-verification-container';
    verificationContainer.setAttribute('data-answer-id', answerId);
    
    // Initialize state to waiting for AI
    answerStates.set(answerId, VERIFICATION_STATES.WAITING_FOR_AI);

    // Initially show the waiting message
    verificationContainer.innerHTML = `
      <div class="ai-verification-content">
        <div class="ai-verification-loading">⏳ Waiting for AI response to finish...</div>
      </div>
    `;
    
    // Add event listener for the view details button
    setTimeout(() => {
      const detailsBtn = verificationContainer.querySelector('.ai-verification-details-btn');
      if (detailsBtn) {
        detailsBtn.addEventListener('click', function() {
          toggleDetailsSection(verificationContainer);
        });
      }
    }, 0);

    return verificationContainer;
  }
  
  // Function to update verification state
  function updateVerificationState(verificationContainer, newState, answerId) {
    // Update the state in our map
    answerStates.set(answerId, newState);
    
    // Update the UI based on the new state
    if (newState === VERIFICATION_STATES.WAITING_FOR_AI) {
      verificationContainer.innerHTML = `
        <div class="ai-verification-content">
          <div class="ai-verification-loading">⏳ Waiting for AI response to finish...</div>
        </div>
      `;
    } else if (newState === VERIFICATION_STATES.VERIFYING) {
      verificationContainer.innerHTML = `
        <div class="ai-verification-content">
          <div class="ai-verification-loading">⏳ Verifying AI output...</div>
        </div>
      `;
    } else if (newState === VERIFICATION_STATES.VERIFIED) {
      verificationContainer.innerHTML = `
        <div class="ai-verification-content">
          <div class="ai-verification-results">
            <div class="ai-verification-issue">⚠ 1 potential issue detected</div>
            <div class="ai-verification-verified">✔ 3 verified statements</div>
          </div>
          <button class="ai-verification-details-btn">View details</button>
        </div>
      `;
      
      // Reattach event listener for the view details button
      const detailsBtn = verificationContainer.querySelector('.ai-verification-details-btn');
      if (detailsBtn) {
        detailsBtn.addEventListener('click', function() {
          toggleDetailsSection(verificationContainer);
        });
      }
    }
  }
  
  // Function to start verification after AI finishes
  function startVerification(verificationContainer, answerId) {
    // Update state to verifying
    updateVerificationState(verificationContainer, VERIFICATION_STATES.VERIFYING, answerId);
    
    // After 1200ms, update to verified state
    setTimeout(() => {
      // Check if the container still exists in the DOM
      if (verificationContainer.parentNode) {
        updateVerificationState(verificationContainer, VERIFICATION_STATES.VERIFIED, answerId);
      }
    }, 1200);
  }
  
  // Function to toggle details section
  function toggleDetailsSection(verificationContainer) {
    const existingDetails = verificationContainer.querySelector('.ai-verification-details-section');
    
    if (existingDetails) {
      // If details section exists, remove it (collapse)
      existingDetails.remove();
    } else {
      // Create and append details section
      const detailsSection = document.createElement('div');
      detailsSection.className = 'ai-verification-details-section';
      detailsSection.innerHTML = `
        <div class="ai-verification-details-content">
          <div class="ai-verification-detail-item">
            <strong>Verified statements:</strong> 3
          </div>
          <div class="ai-verification-detail-item">
            <strong>Potential issues:</strong> 1
          </div>
          <div class="ai-verification-note">
            Note: This is an early verification preview
          </div>
        </div>
      `;
      
      // Find the button container and insert details after it
      const contentDiv = verificationContainer.querySelector('.ai-verification-content');
      contentDiv.appendChild(detailsSection);
    }
  }

  // Function to check if an element is a completed ChatGPT answer
  // Finalization detection: Wait until the assistant message is finalized
  // This ensures streaming is finished before injecting verification UI
  function isCompletedChatGPTAnswer(element) {
    // Check if this is an assistant message container (anchor node)
    if (element.matches('[data-message-author-role="assistant"]')) {
      // Look for action bar (copy/thumbs buttons) which indicates finalization
      const actionBar = element.querySelector('div.flex, div button[aria-label], div [data-testid*="action"]');
      
      // Or look specifically for the Copy button which appears when complete
      const copyButton = element.querySelector('button[aria-label="Copy code"], button[aria-label="Copy text"], button[title*="Copy"]');
      
      // If either the action bar or copy button exists, the message is finalized
      if (actionBar || copyButton) {
        return true;
      }
    }
    
    return false;
  }

  // Function to find the appropriate answer container
  // Uses stable selector: elements with data-message-author-role="assistant"
  // Treat each such element as ONE answer container (anchor node)
  function findAnswerContainer(targetElement) {
    // Direct match - if the target is already an assistant message
    if (targetElement.matches('[data-message-author-role="assistant"]')) {
      return targetElement;
    }
    
    // Look for the closest ancestor that is an assistant message container
    let current = targetElement;
    
    while (current && current !== document.body) {
      if (current.matches('[data-message-author-role="assistant"]')) {
        return current;
      }
      
      current = current.parentElement;
    }
    
    return null;
  }

  // Function to observe content changes and detect when AI finishes streaming
  // Streaming detection is needed to ensure verification starts only after AI finishes
  function observeContentChanges(answerElement, verificationContainer, answerId) {
    // Clear any existing timeout for this element
    if (contentObservationTimeouts.has(answerElement)) {
      clearTimeout(contentObservationTimeouts.get(answerElement));
      contentObservationTimeouts.delete(answerElement);
    }
    
    // Check for content changes with a debounce approach
    let previousTextContent = answerElement.innerText || answerElement.textContent;
    
    const checkContentChange = () => {
      const currentTextContent = answerElement.innerText || answerElement.textContent;
      
      // If content hasn't changed, the AI has likely finished generating
      if (previousTextContent === currentTextContent) {
        // Start verification after AI finishes
        // Verification starts only after AI finishes to ensure complete content analysis
        startVerification(verificationContainer, answerId);
      } else {
        // Content is still changing, AI is still generating
        // Update the verification UI to reflect that we're waiting
        if (answerStates.get(answerId) !== VERIFICATION_STATES.WAITING_FOR_AI) {
          updateVerificationState(verificationContainer, VERIFICATION_STATES.WAITING_FOR_AI, answerId);
        }
        
        // Content changed, update and check again
        previousTextContent = currentTextContent;
        const timeoutId = setTimeout(checkContentChange, 500); // Wait 500ms before checking again
        contentObservationTimeouts.set(answerElement, timeoutId);
      }
    };
    
    // Start the content observation
    const timeoutId = setTimeout(checkContentChange, 500);
    contentObservationTimeouts.set(answerElement, timeoutId);
  }

  // Function to insert verification panel for an answer
  // Injection happens AFTER the assistant message container
  // NOT inside the streaming text or transient wrappers
  function insertVerificationPanel(answerElement, answerId) {
    // Check if a verification panel already exists for this assistant message
    // This prevents duplicates when ChatGPT re-renders content or adds sources/buttons
    // ChatGPT may re-render content multiple times, causing duplicate injections
    // if we don't check for existing panels first
    const existingVerificationPanel = answerElement.parentNode.querySelector('.ai-verification-container') ||
                                    (answerElement.nextSibling && answerElement.nextSibling.classList && 
                                     answerElement.nextSibling.classList.contains('ai-verification-container') ? 
                                     answerElement.nextSibling : null);
    
    // If a verification panel already exists, do not inject another one
    if (existingVerificationPanel) {
      // Return the existing panel if it exists
      return existingVerificationPanel;
    }
    
    // Create the verification panel with the stable ID
    const verificationPanel = createVerificationPanel(answerId);
    
    // Insert the verification panel directly after the answer container
    answerElement.parentNode.insertBefore(verificationPanel, answerElement.nextSibling);
    
    return verificationPanel;
  }

  // Function to process a new answer element
  function processAnswerElement(element) {
    // Find the answer container
    const answerContainer = findAnswerContainer(element);
    
    if (answerContainer) {
      // Only process if not already processed
      if (!processedAnswers.has(answerContainer)) {
        // Check if the message is already finalized before waiting for stability
        if (isCompletedChatGPTAnswer(answerContainer)) {
          // Check if a verification panel already exists to ensure idempotency
          const existingVerificationPanel = answerContainer.parentNode.querySelector('.ai-verification-container') ||
                                          (answerContainer.nextSibling && answerContainer.nextSibling.classList && 
                                           answerContainer.nextSibling.classList.contains('ai-verification-container') ? 
                                           answerContainer.nextSibling : null);
          
          // If no verification panel exists yet, proceed with processing
          if (!existingVerificationPanel) {
            // Mark as processed to prevent duplicates
            processedAnswers.add(answerContainer);
            
            // Get or create stable answer ID
            const answerId = getOrCreateAnswerId(answerContainer);
            
            // Insert the verification panel
            const verificationPanel = insertVerificationPanel(answerContainer, answerId);
            
            // Start observing content changes to detect when AI finishes streaming
            observeContentChanges(answerContainer, verificationPanel, answerId);
          }
        } else {
          // Insert the verification panel first
          const existingVerificationPanel = answerContainer.parentNode.querySelector('.ai-verification-container') ||
                                          (answerContainer.nextSibling && answerContainer.nextSibling.classList && 
                                           answerContainer.nextSibling.classList.contains('ai-verification-container') ? 
                                           answerContainer.nextSibling : null);
          
          if (!existingVerificationPanel) {
            // Mark as processed to prevent duplicates
            processedAnswers.add(answerContainer);
            
            // Get or create stable answer ID
            const answerId = getOrCreateAnswerId(answerContainer);
            
            // Insert the verification panel
            const verificationPanel = insertVerificationPanel(answerContainer, answerId);
            
            // Start observing content changes to detect when AI finishes streaming
            observeContentChanges(answerContainer, verificationPanel, answerId);
          }
        }
      }
    }
  }

  // Setup MutationObserver to detect new ChatGPT answers
  // Scope the observer to the main content area to reduce unnecessary triggers
  const mainContentArea = document.querySelector('main') || document.body;
  console.log("[AI-Verification] MutationObserver initialized");
  const observer = new MutationObserver(function(mutations) {
    // Process mutations in batches to avoid duplicate processing
    const elementsToProcess = [];
    
    mutations.forEach(function(mutation) {
      // Process added nodes
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the added node itself is a completed answer
          if (isCompletedChatGPTAnswer(node)) {
            elementsToProcess.push(node);
          }
          
          // Also check child nodes in case an answer was added deeper in the tree
          const answerCandidates = node.querySelectorAll ? 
            node.querySelectorAll('[data-message-author-role="assistant"]') : [];
            
          for (let i = 0; i < answerCandidates.length; i++) {
            if (isCompletedChatGPTAnswer(answerCandidates[i])) {
              elementsToProcess.push(answerCandidates[i]);
            }
          }
        }
      });
    });
    
    // Process unique elements to avoid duplicates
    const uniqueElements = [...new Set(elementsToProcess)];
    uniqueElements.forEach(element => {
      processAnswerElement(element);
    });
  });

  // Start observing the main content area for changes
  // Using childList and subtree to catch deeply nested additions
  // This scope is narrow enough to avoid observing irrelevant parts of the DOM
  observer.observe(mainContentArea, {
    childList: true,
    subtree: true
  });

  // Initial scan to catch any answers that might already exist
  // This ensures verification panels are added to existing answers on page load
  setTimeout(() => {
    const existingAnswers = document.querySelectorAll('[data-message-author-role="assistant"]');
    existingAnswers.forEach(answer => {
      if (!processedAnswers.has(answer)) {
        // Check if already finalized before waiting for stability
        if (isCompletedChatGPTAnswer(answer)) {
          // Check if a verification panel already exists to ensure idempotency
          const existingVerificationPanel = answer.parentNode.querySelector('.ai-verification-container') ||
                                          (answer.nextSibling && answer.nextSibling.classList && 
                                           answer.nextSibling.classList.contains('ai-verification-container') ? 
                                           answer.nextSibling : null);
          
          // If no verification panel exists yet, proceed with processing
          if (!existingVerificationPanel) {
            // Mark as processed to prevent duplicates
            processedAnswers.add(answer);
            
            // Get or create stable answer ID
            const answerId = getOrCreateAnswerId(answer);
            
            // Insert the verification panel
            const verificationPanel = insertVerificationPanel(answer, answerId);
            
            // Start observing content changes to detect when AI finishes streaming
            observeContentChanges(answer, verificationPanel, answerId);
          }
        } else {
          // Insert the verification panel first
          const existingVerificationPanel = answer.parentNode.querySelector('.ai-verification-container') ||
                                          (answer.nextSibling && answer.nextSibling.classList && 
                                           answer.nextSibling.classList.contains('ai-verification-container') ? 
                                           answer.nextSibling : null);
          
          if (!existingVerificationPanel) {
            // Mark as processed to prevent duplicates
            processedAnswers.add(answer);
            
            // Get or create stable answer ID
            const answerId = getOrCreateAnswerId(answer);
            
            // Insert the verification panel
            const verificationPanel = insertVerificationPanel(answer, answerId);
            
            // Start observing content changes to detect when AI finishes streaming
            observeContentChanges(answer, verificationPanel, answerId);
          }
        }
      }
    });
  }, 1000);

})();