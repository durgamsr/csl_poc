const express = require('express');
const session = require('express-session');
const { generators } = require('openid-client');
const path = require('path');
const cors = require('cors');
const config = require('./config');

// Import services
const cognitoService = require('./services/cognitoService');

// Import routes
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const summaryRoutes = require('./routes/summaryRoutes');

// Import middleware
const { updateTokenInfo } = require('./middleware/auth');

const app = express();
const PORT = config.server.port;

// Enable CORS
app.use(cors({
    origin: config.server.cors.origins,
    credentials: true, // Allow cookies to be sent
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parse JSON request bodies
app.use(express.json());

// Configure session middleware
app.use(session({
    secret: config.server.sessionSecret,
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Apply token update middleware
app.use(updateTokenInfo);

// Initialize Cognito client
cognitoService.initializeClient()
    .then(() => console.log('Cognito client initialized successfully'))
    .catch(err => console.error('Failed to initialize Cognito client:', err));

// Mount routes
app.use('/', authRoutes);

// Mount file routes - files.js already has /api prefixes in its routes
app.use('/', fileRoutes);

// Add summary routes
app.use('/api/summaries', summaryRoutes);

// Add a debugging endpoint
app.get('/api-test', (req, res) => {
    res.json({ message: 'API is working' });
});

// Route debugging middleware - log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// 404 handler for unmatched routes
app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Callback URL: ${config.cognito.redirectUri}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/files`);
}); 