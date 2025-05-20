// Function to generate a unique session ID
function generateSessionId() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    return `session-${dateStr}-${timeStr}`;
}

// Function to get user information from session and build a user object
function getUserFromSession(req) {
    const isAuthenticated = req.session.isAuthenticated || false;
    const userInfo = req.session.userInfo || null;
    
    // Default values
    let username = 'anonymous';
    let userEmail = 'anonymous@user.com';
    
    if (isAuthenticated && userInfo) {
        if (userInfo.username) {
            username = userInfo.username;
        } else if (userInfo['cognito:username']) {
            username = userInfo['cognito:username'];
        }
        
        if (userInfo.email) {
            userEmail = userInfo.email;
            // If username isn't available, generate one from email
            if (!username || username === 'anonymous') {
                username = userEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
            }
        }
    } else if (req.session.currentUploadSession && req.session.currentUploadSession.username) {
        username = req.session.currentUploadSession.username;
    }
    
    return {
        username,
        userEmail,
        isAuthenticated
    };
}

// Function to create a session for file uploads
function createUploadSession(req) {
    const user = getUserFromSession(req);
    const sessionId = generateSessionId();
    
    // Store session info
    const sessionInfo = {
        sessionId,
        created: new Date().toISOString(),
        username: user.username
    };
    
    // Save to session
    req.session.currentUploadSession = sessionInfo;
    
    return {
        ...sessionInfo,
        userEmail: user.userEmail,
        isAuthenticated: user.isAuthenticated
    };
}

// Function to get the access token from the session
function getAccessToken(req) {
    try {
        if (!req.session) {
            console.log('No session object available');
            return null;
        }
        
        // Check for token in standard location
        if (req.session.tokenSet && req.session.tokenSet.access_token) {
            console.log('Found access_token in session.tokenSet');
            return req.session.tokenSet.access_token;
        }
        
        // Check for token in alternate locations
        if (req.session.accessToken) {
            console.log('Found token in session.accessToken');
            return req.session.accessToken;
        }
        
        if (req.session.userInfo && req.session.userInfo.accessToken) {
            console.log('Found token in session.userInfo.accessToken');
            return req.session.userInfo.accessToken;
        }
        
        // Try to extract from Authorization header as last resort
        if (req.headers && req.headers.authorization) {
            const authHeader = req.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                console.log('Using token from Authorization header');
                return authHeader.substring(7);
            }
        }
        
        console.log('No access token found in session or headers');
        return null;
    } catch (error) {
        console.error('Error retrieving access token:', error);
        return null;
    }
}

// Function to safely get username from session
function getUsernameFromSession(req) {
    try {
        if (!req.session) return 'anonymous';
        
        // Try to get from userInfo
        if (req.session.userInfo) {
            if (req.session.userInfo.username) return req.session.userInfo.username;
            if (req.session.userInfo['cognito:username']) return req.session.userInfo['cognito:username'];
            if (req.session.userInfo.email) return req.session.userInfo.email.split('@')[0];
        }
        
        // Try to get from tokenSet
        if (req.session.tokenSet) {
            try {
                // Handle different token formats
                if (req.session.tokenSet.claims && typeof req.session.tokenSet.claims === 'function') {
                    const claims = req.session.tokenSet.claims();
                    if (claims['cognito:username']) return claims['cognito:username'];
                    if (claims.email) return claims.email.split('@')[0];
                } 
                else if (req.session.tokenSet.id_token_payload) {
                    if (req.session.tokenSet.id_token_payload['cognito:username']) 
                        return req.session.tokenSet.id_token_payload['cognito:username'];
                }
            } catch (err) {
                console.error('Error extracting username from token:', err);
            }
        }
        
        // Fallback to anonymous
        return 'anonymous';
    } catch (error) {
        console.error('Error getting username from session:', error);
        return 'anonymous';
    }
}

module.exports = {
    generateSessionId,
    getUserFromSession,
    createUploadSession,
    getAccessToken,
    getUsernameFromSession
}; 