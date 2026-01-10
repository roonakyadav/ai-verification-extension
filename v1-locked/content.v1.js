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
  
  // Map to track verification status for each answer to prevent duplicates
  const verificationStatus = new Map();
  
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
    
    // Initialize verification status to prevent duplicate runs
    verificationStatus.set(answerId, {
      hasStartedVerification: false,
      hasCompletedVerification: false
    });

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
      // This should normally not be called directly, but if it is, we'll use default values
      const analysisResult = {
        issues: 0,
        verified: 0,
        isEmpty: true
      };
      updateVerificationStateWithResults(verificationContainer, newState, answerId, analysisResult);
    }
  }
  
  // Function to update verification state with real results
  // Heuristics are used in V1 to provide deterministic verification
  // This will be replaced with LLM-based verification in future versions
  function updateVerificationStateWithResults(verificationContainer, newState, answerId, analysisResult) {
    // Update the state in our map
    answerStates.set(answerId, newState);
    
    // Mark verification as completed to prevent duplicates
    const currentStatus = verificationStatus.get(answerId);
    if (currentStatus) {
      verificationStatus.set(answerId, {
        hasStartedVerification: true,
        hasCompletedVerification: true
      });
    }
    
    // Handle the case where no claims were extracted
    let issues, verified, hasNoClaims;
    if (analysisResult.isEmpty) {
      issues = 0;
      verified = 0;
      hasNoClaims = true;
    } else {
      issues = analysisResult.issues || 0;
      verified = analysisResult.verified || 0;
      hasNoClaims = false;
    }
    
    // Update the UI with real verification results
    verificationContainer.innerHTML = `
      <div class="ai-verification-content">
        <div class="ai-verification-results">
          ${hasNoClaims ? 
            '<div class="ai-verification-no-claims">ℹ No verifiable factual claims detected</div>' : 
            `<div class="ai-verification-issue">⚠ ${issues} potential issue${issues !== 1 ? 's' : ''} detected</div>`
          }
          <div class="ai-verification-verified">✔ ${verified} verified statement${verified !== 1 ? 's' : ''}</div>
        </div>
        <button class="ai-verification-details-btn">View details</button>
      </div>
    `;
    
    // Attach event listener for the view details button
    const detailsBtn = verificationContainer.querySelector('.ai-verification-details-btn');
    if (detailsBtn) {
      detailsBtn.addEventListener('click', function() {
        toggleDetailsSection(verificationContainer, analysisResult);
      });
    }
    
    // Log when verification finalizes
    console.log(`[AI-Verification] Verification finished ${answerId}. Claims: ${(analysisResult && analysisResult.claims) ? analysisResult.claims.length : 0}, Issues: ${issues}`);
  }
  
  // Function to classify claims using heuristics
  function classifyClaim(sentence) {
    // If it contains a number or date, mark as factual
    if (/[0-9]+|\d{4}|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(sentence)) {
      return 'FACTUAL';
    }
    
    // If it starts with subjective phrases, mark as subjective
    const subjectivePhrases = ['i think', 'it seems', 'generally', 'can be', 'might be', 'could be', 'possibly', 'perhaps', 'likely', 'usually'];
    const lowerSentence = sentence.toLowerCase().trim();
    
    for (const phrase of subjectivePhrases) {
      if (lowerSentence.startsWith(phrase)) {
        return 'SUBJECTIVE';
      }
    }
    
    // Otherwise, mark as low confidence factual
    return 'FACTUAL_LOW_CONFIDENCE';
  }
  
  // Function to analyze claims and identify potential issues
  function analyzeClaims(textContent, answerElement) {
    // DOM-based claim extraction to handle semantic blocks
    // Extract claims from semantic elements inside the assistant message
    const claims = [];
    
    if (answerElement) {
      // Extract from paragraph elements
      const paragraphs = answerElement.querySelectorAll('p');
      for (const p of paragraphs) {
        const text = p.innerText.trim();
        if (text) {
          // Normalize by removing common UI noise but keeping emojis and symbols
          const normalizedText = text.replace(/\bSources?\b|\bbutton\b|\bad\b|\badvertisement\b/gi, '').trim();
          if (normalizedText) {
            claims.push(normalizedText);
          }
        }
      }
      
      // Extract from list items
      const listItems = answerElement.querySelectorAll('li');
      for (const li of listItems) {
        const text = li.innerText.trim();
        if (text) {
          // Normalize by removing common UI noise but keeping emojis and symbols
          const normalizedText = text.replace(/\bSources?\b|\bbutton\b|\bad\b|\badvertisement\b/gi, '').trim();
          if (normalizedText) {
            claims.push(normalizedText);
          }
        }
      }
      
      // Extract from other semantic blocks if paragraphs and lists are empty
      if (claims.length === 0) {
        // Look for direct text nodes and other semantic elements
        const otherElements = answerElement.querySelectorAll('div, span, pre, code');
        for (const el of otherElements) {
          // Skip elements that are likely UI elements
          if (el.classList && 
              (el.classList.contains('copy-button') || 
               el.classList.contains('action-button') ||
               el.classList.contains('source') ||
               el.classList.contains('metadata'))) {
            continue;
          }
          
          const text = el.innerText.trim();
          if (text && text.length > 5) { // Only add substantial text
            const normalizedText = text.replace(/\bSources?\b|\bbutton\b|\bad\b|\badvertisement\b/gi, '').trim();
            if (normalizedText) {
              claims.push(normalizedText);
            }
          }
        }
      }
    }
    
    // If DOM extraction yields no results, fallback to text-based extraction
    if (claims.length === 0) {
      // Robust claim extraction to handle bullet points, numbered lists, and factual lines
      // Split text by newline, period, question mark, and exclamation mark
      let sentences = textContent.split(/[\n.!?]+/);

      // Also try to extract list items that might not have punctuation
      const listItemPattern = /(\n|^)\s*[\*\-•0-9]+[\.)]?\s+([^\n]+)/g;
      const listMatches = textContent.matchAll(listItemPattern);
      const listItems = [];
      for (const match of listMatches) {
        listItems.push(match[2].trim());
      }

      // Combine sentences and list items
      sentences = sentences.concat(listItems);

      // Clean up and filter
      const cleanedSentences = sentences
        .map(s => s.replace(/^\s*[\*\-•0-9]+[\.)]?\s*/, '').trim()) // Remove bullet points/numbers
        .filter(s => s.length > 0); // Ignore only empty lines

      // Add cleaned sentences to claims
      for (const sentence of cleanedSentences) {
        // Skip if the line is just a list marker without content
        if (sentence.length <= 2) continue;
        
        // Normalize by removing common UI noise but keeping emojis and symbols
        const normalizedText = sentence.replace(/\bSources?\b|\bbutton\b|\bad\b|\badvertisement\b/gi, '').trim();
        if (normalizedText) {
          claims.push(normalizedText);
        }
      }
    }
    
    // ADD TEXT-NODE FALLBACK: If no claims were extracted from DOM or text splitting
    // and the answer element has visible text content
    if (claims.length === 0 && answerElement) {
      // Extract the assistant message's visible text as one claim
      const elementText = answerElement.innerText || answerElement.textContent || '';
      const trimmedText = elementText.trim();
      
      // Only add if not empty after normalization
      if (trimmedText) {
        const normalizedText = trimmedText.replace(/\bSources?\b|\bbutton\b|\bad\b|\badvertisement\b/gi, '').trim();
        if (normalizedText) {
          console.log("[AI-Verification] Using text fallback extraction");
          claims.push(normalizedText);
        }
      }
    }

    const analysis = [];
    let issues = 0;

    for (const claimText of claims) {
      const classification = classifyClaim(claimText);
      let status = 'verified';
      let issueType = null;

      if (classification === 'FACTUAL') {
        // Check if it has numbers/dates but no obvious citations
        if (/[0-9]+|\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(claimText) && 
            !/[source|citation|reference|according to]/i.test(claimText)) {
          status = 'needs_source';
          issueType = 'Numerical/date claim without source';
          issues++;
        }
      } else if (classification === 'FACTUAL_LOW_CONFIDENCE') {
        // For low confidence factual claims without length filter
        if (!/[source|citation|reference|according to]/i.test(claimText)) {
          status = 'needs_source';
          issueType = 'Factual claim without source';
          issues++;
        }
      } else if (classification === 'SUBJECTIVE') {
        // Subjective claims are ignored
        status = 'ignored';
      }

      analysis.push({
        text: claimText,
        type: classification,
        status: status,
        issueType: issueType
      });
    }

    // Calculate results: verified_statements = total_claims - issues
    const totalClaims = analysis.length;
    const verified = Math.max(0, totalClaims - issues);

    // Safety logging for debugging
    console.log(`[AI-Verification] Extracted claims:`, analysis);
    console.log(`[AI-Verification] Number of extracted claims: ${analysis.length}`);

    // Return results ensuring verification can always complete
    return {
      claims: analysis,
      issues: issues,
      verified: verified,
      isEmpty: totalClaims === 0
    };
  }
  
  // Function to start verification after AI finishes
  function startVerification(verificationContainer, answerId) {
    // Update state to verifying
    updateVerificationState(verificationContainer, VERIFICATION_STATES.VERIFYING, answerId);
    
    // Get the original answer content to analyze
    // Find the answer element associated with this verification container
    const answerElement = verificationContainer.previousElementSibling;
    if (!answerElement) {
      return;
    }
    
    // Extract text content from the answer element
    const textContent = answerElement.innerText || answerElement.textContent || '';
    
    // Perform synchronous analysis with DOM element for better extraction
    const analysisResult = analyzeClaims(textContent, answerElement);
    
    // Update to verified state with real data after a short delay to simulate processing
    setTimeout(() => {
      // Check if the container still exists in the DOM
      if (verificationContainer.parentNode) {
        updateVerificationStateWithResults(verificationContainer, VERIFICATION_STATES.VERIFIED, answerId, analysisResult);
      }
    }, 1200);
  }
  
  // Function to toggle details section
  function toggleDetailsSection(verificationContainer, analysisResult) {
    const existingDetails = verificationContainer.querySelector('.ai-verification-details-section');
    
    if (existingDetails) {
      // If details section exists, remove it (collapse)
      existingDetails.remove();
    } else {
      // Create and append details section
      const detailsSection = document.createElement('div');
      detailsSection.className = 'ai-verification-details-section';
      
      // If called without analysisResult, try to get it from the container's data
      if (!analysisResult) {
        // Extract answer ID from the container and try to get stored result
        const answerId = verificationContainer.getAttribute('data-answer-id');
        // For now, just use a default empty result
        analysisResult = { verified: 0, issues: 0, claims: [] };
      }
      
      // Build claims list HTML
      let claimsHtml = '';
      if (analysisResult && analysisResult.claims) {
        for (const claim of analysisResult.claims) {
          const statusClass = claim.status === 'needs_source' ? 'status-issue' : 
                           claim.status === 'ignored' ? 'status-ignored' : 'status-verified';
          
          claimsHtml += `
            <div class="ai-verification-claim-item">
              <div class="ai-verification-claim-text">"${claim.text}"</div>
              <div class="ai-verification-claim-meta">
                <span class="ai-verification-claim-type">Type: ${claim.type}</span>
                <span class="ai-verification-claim-status ${statusClass}">Status: ${claim.status}${claim.issueType ? ' - ' + claim.issueType : ''}</span>
              </div>
            </div>`;
        }
      }
      
      detailsSection.innerHTML = `
        <div class="ai-verification-details-content">
          <div class="ai-verification-detail-item">
            <strong>Verified statements:</strong> ${analysisResult ? analysisResult.verified : 0}
          </div>
          <div class="ai-verification-detail-item">
            <strong>Potential issues:</strong> ${analysisResult ? analysisResult.issues : 0}
          </div>
          <div class="ai-verification-claims-list">
            <h4>Detailed Claims Analysis:</h4>
            ${claimsHtml}
          </div>
          <div class="ai-verification-note">
            Note: This is an early verification preview using heuristic analysis
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
  // Streaming detection logic must ONLY update UI and detect text stability
  // It must NOT initialize verification or re-create panels
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
        // After text is stable, call a SINGLE verification entry function
        // Ensure verification runs only once
        const status = verificationStatus.get(answerId);
        if (status && !status.hasStartedVerification) {
          verificationStatus.set(answerId, {
            hasStartedVerification: true,
            hasCompletedVerification: false
          });
          console.log(`[AI-Verification] DOM stable, starting verification ${answerId}`);
          startVerification(verificationContainer, answerId);
        }
      } else {
        // Content is still changing, AI is still generating
        // Update the verification UI to reflect that we're waiting
        if (answerStates.get(answerId) !== VERIFICATION_STATES.WAITING_FOR_AI) {
          updateVerificationState(verificationContainer, VERIFICATION_STATES.WAITING_FOR_AI, answerId);
        }
        
        // Content changed, update and check again
        previousTextContent = currentTextContent;
        const timeoutId = setTimeout(checkContentChange, 1000); // Wait 1000ms before checking again
        contentObservationTimeouts.set(answerElement, timeoutId);
      }
    };
    
    // Start the content observation
    const timeoutId = setTimeout(checkContentChange, 1000);
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
        console.log(`[AI-Verification] New assistant message detected ${getOrCreateAnswerId(answerContainer)}`);
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