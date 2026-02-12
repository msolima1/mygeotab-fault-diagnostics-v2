/**
 * MyGeotab AI Fault Diagnostics Add-In v2
 *
 * This add-in fetches vehicle fault codes from the MyGeotab API
 * and uses Claude AI (via GenAI Gateway) to provide diagnostic recommendations.
 */

geotab.addin.aiFaultDiagnostics = function () {
    'use strict';

    // Configuration - UPDATE THIS URL after deploying to Netlify
    // For local development: '' (uses relative paths with dev-server.js)
    // For production: 'https://YOUR-SITE.netlify.app' (your Netlify URL)
    const API_BASE_URL = 'https://delicate-frangipane-a0b3f3.netlify.app';
    const AI_ENDPOINT = API_BASE_URL + '/api/claude';
    const WEB_SEARCH_ENDPOINT = API_BASE_URL + '/api/web-search';

    // Private variables
    let api;
    let state;
    let elAddin;
    let devices = [];
    let currentFaults = [];
    let selectedFault = null;

    // Expose devices globally for debugging
    window.devices = devices;

    // DOM Elements
    const elements = {
        apiKeyInput: null,
        saveApiKeyBtn: null,
        vehicleSearch: null,
        vehicleSelect: null,
        vehicleCount: null,
        fetchFaultsBtn: null,
        loading: null,
        faultsSection: null,
        faultsList: null,
        faultCount: null,
        analysisSection: null,
        closeAnalysisBtn: null,
        selectedFaultInfo: null,
        aiLoading: null,
        aiResults: null,
        analysisComparison: null,
        errorMessage: null,
        errorText: null,
        noFaults: null,
        fromDate: null,
        toDate: null
    };

    // Local Storage Keys
    const STORAGE_KEYS = {
        CLAUDE_API_KEY: 'mygeotab_fault_diagnostics_claude_key'
    };

    /**
     * Initialize DOM element references
     */
    function initializeElements() {
        elements.apiKeyInput = document.getElementById('claude-api-key');
        elements.saveApiKeyBtn = document.getElementById('save-api-key');
        elements.vehicleSearch = document.getElementById('vehicle-search');
        elements.vehicleSelect = document.getElementById('vehicle-select');
        elements.vehicleCount = document.getElementById('vehicle-count');
        elements.fetchFaultsBtn = document.getElementById('fetch-faults-btn');
        elements.loading = document.getElementById('loading');
        elements.faultsSection = document.getElementById('faults-section');
        elements.faultsList = document.getElementById('faults-list');
        elements.faultCount = document.getElementById('fault-count');
        elements.analysisSection = document.getElementById('analysis-section');
        elements.closeAnalysisBtn = document.getElementById('close-analysis');
        elements.selectedFaultInfo = document.getElementById('selected-fault-info');
        elements.aiLoading = document.getElementById('ai-loading');
        elements.aiResults = document.getElementById('ai-results');
        elements.analysisComparison = document.getElementById('analysis-comparison');
        elements.errorMessage = document.getElementById('error-message');
        elements.errorText = document.getElementById('error-text');
        elements.noFaults = document.getElementById('no-faults');
        elements.fromDate = document.getElementById('from-date');
        elements.toDate = document.getElementById('to-date');

        // Set default date range (last 30 days)
        if (elements.fromDate && elements.toDate) {
            const today = new Date();
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            elements.toDate.value = today.toISOString().split('T')[0];
            elements.fromDate.value = thirtyDaysAgo.toISOString().split('T')[0];
        }
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        elements.saveApiKeyBtn.addEventListener('click', saveApiKey);
        elements.vehicleSearch.addEventListener('input', onVehicleSearch);
        elements.vehicleSelect.addEventListener('change', onVehicleChange);
        elements.fetchFaultsBtn.addEventListener('click', fetchFaultCodes);
        elements.closeAnalysisBtn.addEventListener('click', closeAnalysisPanel);
    }

    /**
     * Filter vehicles based on search input
     */
    function onVehicleSearch() {
        const searchTerm = elements.vehicleSearch.value.trim();

        if (searchTerm.length >= 2) {
            // Search via API for better results
            searchDevicesAPI(searchTerm);
        } else if (searchTerm.length === 0) {
            // Reset to initial load
            loadVehicles();
        } else {
            // Filter locally for single character
            filterVehicleDropdown(searchTerm.toLowerCase());
        }
    }

    /**
     * Filter and repopulate vehicle dropdown
     */
    function filterVehicleDropdown(searchTerm) {
        elements.vehicleSelect.innerHTML = '';

        const filtered = devices.filter(function(device) {
            const name = (device.name || device.serialNumber || device.id || '').toLowerCase();
            return name.includes(searchTerm);
        });

        if (filtered.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = searchTerm ? 'No matching assets' : 'No assets found';
            elements.vehicleSelect.appendChild(option);
        } else {
            filtered.forEach(function(device) {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = device.name || device.serialNumber || device.id;
                elements.vehicleSelect.appendChild(option);
            });
        }

        // Update count
        elements.vehicleCount.textContent = searchTerm
            ? `${filtered.length} of ${devices.length} assets`
            : `${devices.length} assets`;

        // Reset button state
        elements.fetchFaultsBtn.disabled = true;
    }

    /**
     * Load saved API key from local storage
     */
    function loadSavedApiKey() {
        const savedKey = localStorage.getItem(STORAGE_KEYS.CLAUDE_API_KEY);
        if (savedKey) {
            elements.apiKeyInput.value = savedKey;
        }
    }

    /**
     * Save API key to local storage
     */
    function saveApiKey() {
        const apiKey = elements.apiKeyInput.value.trim();
        if (apiKey) {
            localStorage.setItem(STORAGE_KEYS.CLAUDE_API_KEY, apiKey);
            showSuccess('API key saved successfully');
        } else {
            showError('Please enter a valid API key');
        }
    }

    /**
     * Get the saved Claude API key
     */
    function getClaudeApiKey() {
        return localStorage.getItem(STORAGE_KEYS.CLAUDE_API_KEY);
    }

    /**
     * Load initial devices from MyGeotab API
     */
    function loadVehicles() {
        console.log('Loading devices...');
        showLoading(true);

        api.call('Get', {
            typeName: 'Device',
            resultsLimit: 1000
        }, function (result) {
            devices = result || [];
            window.devices = devices;
            console.log('Initial devices loaded:', devices.length);
            populateVehicleDropdown();
            showLoading(false);

            // Show hint about searching
            elements.vehicleCount.textContent = `${devices.length} devices (type to search all)`;
        }, function (error) {
            console.error('Failed to load devices:', error);
            showError('Failed to load devices: ' + error);
            showLoading(false);
        });
    }

    /**
     * Search devices via API (server-side search)
     */
    let searchTimeout = null;
    function searchDevicesAPI(searchTerm) {
        if (searchTimeout) clearTimeout(searchTimeout);

        // Debounce to avoid too many API calls
        searchTimeout = setTimeout(function() {
            console.log('Searching API for:', searchTerm);
            elements.vehicleCount.textContent = 'Searching...';

            api.call('Get', {
                typeName: 'Device',
                search: {
                    name: '%' + searchTerm + '%'
                },
                resultsLimit: 100
            }, function (result) {
                devices = result || [];
                window.devices = devices;
                console.log('Search results:', devices.length);
                filterVehicleDropdown(''); // Show all results (already filtered by API)
                elements.vehicleCount.textContent = `${devices.length} matches`;
            }, function (error) {
                console.error('Search failed:', error);
                elements.vehicleCount.textContent = 'Search failed';
            });
        }, 300);
    }

    /**
     * Populate vehicle dropdown with devices
     */
    function populateVehicleDropdown() {
        // Sort devices by name
        devices.sort(function(a, b) {
            const nameA = (a.name || a.serialNumber || a.id || '').toLowerCase();
            const nameB = (b.name || b.serialNumber || b.id || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Clear search and populate
        elements.vehicleSearch.value = '';
        filterVehicleDropdown('');
    }

    /**
     * Handle vehicle selection change
     */
    function onVehicleChange() {
        const selectedId = elements.vehicleSelect.value;
        elements.fetchFaultsBtn.disabled = !selectedId;

        // Hide previous results
        hideElement(elements.faultsSection);
        hideElement(elements.analysisSection);
        hideElement(elements.noFaults);
        hideElement(elements.errorMessage);
    }

    /**
     * Fetch fault codes for selected vehicle
     */
    function fetchFaultCodes() {
        const deviceId = elements.vehicleSelect.value;
        if (!deviceId) {
            showError('Please select a vehicle');
            return;
        }

        showLoading(true);
        hideElement(elements.faultsSection);
        hideElement(elements.noFaults);
        hideElement(elements.analysisSection);

        // Get date range from inputs or use defaults
        let fromDate, toDate;
        if (elements.fromDate && elements.fromDate.value) {
            fromDate = new Date(elements.fromDate.value).toISOString();
        } else {
            fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        }
        if (elements.toDate && elements.toDate.value) {
            // Set to end of day
            const endDate = new Date(elements.toDate.value);
            endDate.setHours(23, 59, 59, 999);
            toDate = endDate.toISOString();
        } else {
            toDate = new Date().toISOString();
        }

        // Fetch FaultData for the selected device
        api.call('Get', {
            typeName: 'FaultData',
            search: {
                deviceSearch: {
                    id: deviceId
                },
                fromDate: fromDate,
                toDate: toDate
            },
            resultsLimit: 100
        }, function (faultDataResult) {
            showLoading(false);
            currentFaults = faultDataResult || [];

            if (currentFaults.length === 0) {
                showElement(elements.noFaults);
            } else {
                // Fetch diagnostic details for each fault
                fetchDiagnosticDetails(currentFaults);
            }
        }, function (error) {
            showLoading(false);
            showError('Failed to fetch fault codes: ' + error);
        });
    }

    /**
     * Fetch diagnostic details for fault codes
     */
    function fetchDiagnosticDetails(faults) {
        // Get unique diagnostic IDs
        const diagnosticIds = [...new Set(faults
            .filter(f => f.diagnostic && f.diagnostic.id)
            .map(f => f.diagnostic.id))];

        if (diagnosticIds.length === 0) {
            displayFaults(faults, {});
            return;
        }

        // Build multi-call to fetch all diagnostics
        const calls = diagnosticIds.map(id => ['Get', {
            typeName: 'Diagnostic',
            search: { id: id }
        }]);

        api.multiCall(calls, function (results) {
            const diagnosticsMap = {};
            results.forEach(function (result, index) {
                if (result && result.length > 0) {
                    diagnosticsMap[diagnosticIds[index]] = result[0];
                }
            });
            displayFaults(faults, diagnosticsMap);
        }, function (error) {
            // If multicall fails, display faults without diagnostic details
            console.error('Failed to fetch diagnostic details:', error);
            displayFaults(faults, {});
        });
    }

    /**
     * Display fault codes in the UI
     */
    function displayFaults(faults, diagnosticsMap) {
        elements.faultsList.innerHTML = '';
        elements.faultCount.textContent = faults.length;

        // Group faults by diagnostic code for better display
        const groupedFaults = {};
        faults.forEach(function (fault) {
            const diagId = fault.diagnostic ? fault.diagnostic.id : 'unknown';
            if (!groupedFaults[diagId]) {
                groupedFaults[diagId] = {
                    faults: [],
                    diagnostic: diagnosticsMap[diagId] || null
                };
            }
            groupedFaults[diagId].faults.push(fault);
        });

        // Create fault items
        Object.keys(groupedFaults).forEach(function (diagId) {
            const group = groupedFaults[diagId];
            const latestFault = group.faults[0];
            const diagnostic = group.diagnostic;

            const faultItem = createFaultItem(latestFault, diagnostic, group.faults.length);
            elements.faultsList.appendChild(faultItem);
        });

        showElement(elements.faultsSection);
    }

    /**
     * Create a fault item element
     */
    function createFaultItem(fault, diagnostic, occurrences) {
        const item = document.createElement('div');
        item.className = 'fault-item';

        // Determine severity class
        let severityClass = 'severity-low';
        let severityText = 'Low';
        if (fault.redStopLamp) {
            severityClass = 'severity-critical';
            severityText = 'Critical';
        } else if (fault.amberWarningLamp) {
            severityClass = 'severity-warning';
            severityText = 'Warning';
        } else if (fault.malfunctionLamp) {
            severityClass = 'severity-medium';
            severityText = 'Medium';
        }

        // Get fault code
        const faultCode = getFaultCode(fault, diagnostic);
        const faultName = diagnostic ? diagnostic.name : 'Unknown Fault';
        const faultDate = new Date(fault.dateTime).toLocaleString();

        item.innerHTML = `
            <div class="fault-header">
                <div class="fault-code-badge">${faultCode}</div>
                <span class="severity-badge ${severityClass}">${severityText}</span>
            </div>
            <div class="fault-details">
                <h4 class="fault-name">${faultName}</h4>
                <p class="fault-meta">
                    <span class="occurrences">${occurrences} occurrence${occurrences > 1 ? 's' : ''}</span>
                    <span class="separator">|</span>
                    <span class="date">Last: ${faultDate}</span>
                </p>
                ${fault.faultDescription ? `<p class="fault-description">${fault.faultDescription}</p>` : ''}
            </div>
            <button class="btn btn-analyze" data-fault-id="${fault.id}">
                Analyze with AI
            </button>
        `;

        // Store fault data on the element for later use
        item.faultData = {
            fault: fault,
            diagnostic: diagnostic,
            faultCode: faultCode,
            faultName: faultName,
            occurrences: occurrences
        };

        // Add click handler for analyze button
        const analyzeBtn = item.querySelector('.btn-analyze');
        analyzeBtn.addEventListener('click', function () {
            analyzeFaultWithAI(item.faultData);
        });

        return item;
    }

    /**
     * Get fault code string (OBD-II DTC or J1939 SPN/FMI)
     */
    function getFaultCode(fault, diagnostic) {
        if (!diagnostic) {
            return 'Unknown';
        }

        // Handle different source formats (object with id, or just string)
        let source = '';
        if (diagnostic.source) {
            source = typeof diagnostic.source === 'string'
                ? diagnostic.source
                : (diagnostic.source.id || '');
        }
        const code = diagnostic.code;

        console.log('Diagnostic:', diagnostic.name, 'Source:', source, 'Code:', code);

        // Check if OBD-II (source contains 'Obd')
        if (source.includes('Obd') || source.includes('OBD')) {
            // Determine prefix based on controller
            let prefix = 'P'; // Default to Powertrain
            if (fault.controller) {
                const controllerId = typeof fault.controller === 'string'
                    ? fault.controller
                    : (fault.controller.id || '');
                if (controllerId.includes('Body')) prefix = 'B';
                else if (controllerId.includes('Chassis')) prefix = 'C';
                else if (controllerId.includes('Network')) prefix = 'U';
            }
            // Convert code to hex and format (code 564 -> 0234 -> P0234)
            const hexCode = code.toString(16).toUpperCase().padStart(4, '0');
            return prefix + hexCode;
        }

        // Check if J1939
        if (source.includes('J1939')) {
            const spn = code;
            let fmi = '';
            if (fault.failureMode) {
                fmi = typeof fault.failureMode === 'object'
                    ? (fault.failureMode.code || '')
                    : '';
            }
            return fmi ? `SPN ${spn} / FMI ${fmi}` : `SPN ${spn}`;
        }

        // Fallback - try to show as hex anyway for potential OBD codes
        if (code && code > 0) {
            const hexCode = code.toString(16).toUpperCase().padStart(4, '0');
            return 'P' + hexCode;
        }

        return `Code ${code}`;
    }

    /**
     * Analyze fault with Claude AI (via Google Cloud Function)
     * Also fetches YouTube/Reddit community insights in parallel
     */
    function analyzeFaultWithAI(faultData) {

        selectedFault = faultData;

        // Show analysis section
        showElement(elements.analysisSection);
        showElement(elements.aiLoading);
        hideElement(elements.aiResults);

        // Display selected fault info
        elements.selectedFaultInfo.innerHTML = `
            <div class="selected-fault-card">
                <span class="fault-code-badge large">${faultData.faultCode}</span>
                <div class="fault-info">
                    <h4>${faultData.faultName}</h4>
                    <p>${faultData.occurrences} occurrence${faultData.occurrences > 1 ? 's' : ''}</p>
                </div>
            </div>
        `;

        // Build prompt for Claude
        const prompt = buildClaudePrompt(faultData);

        // Call both APIs in parallel
        const claudePromise = callClaudeAPI(prompt);
        const webSearchPromise = callWebSearchAPI(faultData.faultCode, faultData.faultName);

        Promise.all([claudePromise, webSearchPromise])
            .then(([claudeResult, webSearchResult]) => {
                hideElement(elements.aiLoading);
                displayComparisonResults(claudeResult, webSearchResult);
            })
            .catch(error => {
                hideElement(elements.aiLoading);
                showError('Analysis failed: ' + error.message);
            });
    }

    /**
     * Build prompt for Claude API
     */
    function buildClaudePrompt(faultData) {
        const fault = faultData.fault;
        const diagnostic = faultData.diagnostic;

        let context = `You are an expert vehicle diagnostic technician. Analyze the following vehicle fault code and provide actionable recommendations.

FAULT CODE: ${faultData.faultCode}
FAULT NAME: ${faultData.faultName}
OCCURRENCES: ${faultData.occurrences}`;

        if (fault.faultDescription) {
            context += `\nDESCRIPTION: ${fault.faultDescription}`;
        }

        if (diagnostic && diagnostic.name) {
            context += `\nDIAGNOSTIC NAME: ${diagnostic.name}`;
        }

        // Add severity indicators
        if (fault.redStopLamp) {
            context += '\nSEVERITY: CRITICAL - Red Stop Lamp Active';
        } else if (fault.amberWarningLamp) {
            context += '\nSEVERITY: WARNING - Amber Warning Lamp Active';
        } else if (fault.malfunctionLamp) {
            context += '\nSEVERITY: MEDIUM - Malfunction Indicator Lamp Active';
        }

        if (fault.recommendation) {
            context += `\nEXISTING RECOMMENDATION: ${fault.recommendation}`;
        }

        if (fault.effectOnComponent) {
            context += `\nKNOWN EFFECT: ${fault.effectOnComponent}`;
        }

        context += `

Respond with a brief JSON object (keep it concise):
{"summary":"1 sentence","causes":["cause1","cause2"],"actions":["action1","action2"],"severity":"low|medium|high"}`;

        return context;
    }

    /**
     * Call Claude API via Google Cloud Function
     * Returns a Promise with the parsed analysis result
     */
    function callClaudeAPI(prompt) {
        const requestBody = {
            prompt: prompt
        };

        return fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Claude response:', data);

            if (data.error) {
                throw new Error(data.error.message || data.error || 'Claude API error');
            }

            // GenAI gateway uses OpenAI format
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const textContent = data.choices[0].message.content;
                return parseClaudeResponse(textContent);
            } else {
                throw new Error('Invalid response from Claude API');
            }
        });
    }

    /**
     * Call Web Search API for YouTube/Reddit insights
     * Returns a Promise with community insights
     */
    function callWebSearchAPI(faultCode, faultName) {
        const requestBody = {
            faultCode: faultCode,
            faultName: faultName
        };

        return fetch(WEB_SEARCH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Web search failed: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Web search response:', data);

            if (data.error) {
                return { error: data.error, content: 'Unable to fetch community insights.' };
            }

            // GenAI gateway uses OpenAI format
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return { content: data.choices[0].message.content };
            } else {
                return { content: 'No community insights available.' };
            }
        })
        .catch(error => {
            console.error('Web search error:', error);
            return { error: error.message, content: 'Unable to fetch community insights.' };
        });
    }

    /**
     * Parse Claude API response and return structured data
     */
    function parseClaudeResponse(responseText) {
        try {
            // Extract JSON from response (it might be wrapped in markdown code blocks)
            let jsonStr = responseText;
            const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }

            const analysis = JSON.parse(jsonStr);
            return { parsed: true, data: analysis, raw: responseText };
        } catch (error) {
            // If JSON parsing fails, return raw text
            return { parsed: false, data: null, raw: responseText };
        }
    }

    /**
     * Display comparison results in two-column table
     */
    function displayComparisonResults(claudeResult, webSearchResult) {
        // Get fault code for search links
        const faultCode = selectedFault ? selectedFault.faultCode : '';
        const faultName = selectedFault ? selectedFault.faultName : '';
        const searchQuery = encodeURIComponent(`${faultCode} ${faultName} fix repair`);

        // Build Claude AI summary
        let claudeSummary = '';
        if (claudeResult.parsed && claudeResult.data) {
            const analysis = claudeResult.data;
            const items = [];

            if (analysis.recommendedActions && analysis.recommendedActions.length > 0) {
                items.push(...analysis.recommendedActions.slice(0, 3));
            }
            if (analysis.actionsToTake && analysis.actionsToTake.length > 0) {
                analysis.actionsToTake.slice(0, 2).forEach(item => {
                    items.push(`${item.priority ? item.priority.toUpperCase() + ': ' : ''}${item.action}`);
                });
            }

            claudeSummary = items.length > 0
                ? '<ul class="summary-list">' + items.map(i => `<li>${i}</li>`).join('') + '</ul>'
                : formatTextToHtml(claudeResult.raw);
        } else {
            claudeSummary = formatTextToHtml(claudeResult.raw);
        }

        // Build Web Search summary (YouTube/Reddit)
        let webSummary = '';
        if (webSearchResult.content) {
            // Parse bullet points from the response
            const lines = webSearchResult.content.split('\n').filter(line => line.trim());
            const bulletPoints = lines.filter(line => line.match(/^[\s]*[•\-\*]/));

            if (bulletPoints.length > 0) {
                webSummary = '<ul class="summary-list">' +
                    bulletPoints.map(bp => `<li>${bp.replace(/^[\s]*[•\-\*]\s*/, '')}</li>`).join('') +
                    '</ul>';
            } else {
                webSummary = formatTextToHtml(webSearchResult.content);
            }
        } else {
            webSummary = '<p class="no-data">No community insights available</p>';
        }

        // Build source links for YouTube and Reddit
        const sourceLinks = `
            <div class="source-links">
                <a href="https://www.youtube.com/results?search_query=${searchQuery}" target="_blank" rel="noopener" class="source-link youtube-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    Search YouTube
                </a>
                <a href="https://www.reddit.com/search/?q=${searchQuery}" target="_blank" rel="noopener" class="source-link reddit-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                    Search Reddit
                </a>
            </div>
        `;

        // Display in comparison table
        const comparisonHtml = `
            <div class="comparison-table">
                <div class="comparison-column claude-column">
                    <div class="column-header">
                        <span class="column-icon">🤖</span>
                        <h4>Claude AI Analysis</h4>
                    </div>
                    <div class="column-content">
                        ${claudeSummary}
                    </div>
                </div>
                <div class="comparison-column community-column">
                    <div class="column-header">
                        <span class="column-icon">🌐</span>
                        <h4>YouTube & Reddit Insights</h4>
                    </div>
                    <div class="column-content">
                        ${webSummary}
                        ${sourceLinks}
                    </div>
                </div>
            </div>
        `;

        elements.analysisComparison.innerHTML = comparisonHtml;
        showElement(elements.aiResults);
    }

    /**
     * Display raw analysis text when JSON parsing fails
     */
    function displayRawAnalysis(responseText) {
        elements.recommendedActions.innerHTML = `<div class="raw-analysis">${formatTextToHtml(responseText)}</div>`;
        elements.effectOnComponents.innerHTML = '<p class="no-data">See analysis above</p>';
        elements.actionsToTake.innerHTML = '<p class="no-data">See analysis above</p>';
        showElement(elements.aiResults);
    }

    /**
     * Format plain text to HTML
     */
    function formatTextToHtml(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    /**
     * Close analysis panel
     */
    function closeAnalysisPanel() {
        hideElement(elements.analysisSection);
        selectedFault = null;
    }

    /**
     * Show loading state
     */
    function showLoading(show) {
        if (show) {
            showElement(elements.loading);
        } else {
            hideElement(elements.loading);
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        elements.errorText.textContent = message;
        showElement(elements.errorMessage);

        // Auto-hide after 5 seconds
        setTimeout(function () {
            hideElement(elements.errorMessage);
        }, 5000);
    }

    /**
     * Show success message (temporary implementation using error styling)
     */
    function showSuccess(message) {
        elements.errorText.textContent = message;
        elements.errorMessage.classList.add('success');
        showElement(elements.errorMessage);

        setTimeout(function () {
            hideElement(elements.errorMessage);
            elements.errorMessage.classList.remove('success');
        }, 3000);
    }

    /**
     * Show element
     */
    function showElement(element) {
        element.classList.remove('hidden');
    }

    /**
     * Hide element
     */
    function hideElement(element) {
        element.classList.add('hidden');
    }

    // Public interface (MyGeotab Add-In lifecycle methods)
    return {
        /**
         * Initialize the add-in
         * Called once when the page loads
         */
        initialize: function (freshApi, freshState, initializeCallback) {
            api = freshApi;
            state = freshState;
            elAddin = document.getElementById('fault-diagnostics-addin');

            // Initialize elements and event listeners
            initializeElements();
            setupEventListeners();
            loadSavedApiKey();

            // Signal that initialization is complete
            initializeCallback();
        },

        /**
         * Focus callback
         * Called when the add-in becomes visible
         */
        focus: function (freshApi, freshState) {
            api = freshApi;
            state = freshState;

            // Load vehicles when the add-in gains focus
            loadVehicles();
        },

        /**
         * Blur callback
         * Called when navigating away from the add-in
         */
        blur: function () {
            // Cleanup if needed
            currentFaults = [];
            selectedFault = null;
        }
    };
};
