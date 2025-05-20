import React, { useState, useEffect, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import './HomePage.css';

const HomePage = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const featuresRef = useRef(null);

  useEffect(() => {
    // Check authentication status from the backend
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('http://localhost:3001/check-auth', {
          credentials: 'include' // Important for cookies
        });
        const data = await response.json();
        
        setIsAuthenticated(data.isAuthenticated);
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    // Add scroll event listener for header and animations
    const handleScroll = () => {
      // Header scroll effect
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }

      // Feature cards animation on scroll
      if (featuresRef.current) {
        const featureCards = featuresRef.current.querySelectorAll('.feature-card');
        featureCards.forEach(card => {
          const cardTop = card.getBoundingClientRect().top;
          const windowHeight = window.innerHeight;
          if (cardTop < windowHeight * 0.8) {
            card.classList.add('animated');
          }
        });
      }
    };

    window.addEventListener('scroll', handleScroll);
    
    // Trigger once on load to check for elements in initial viewport
    setTimeout(() => {
      handleScroll();
    }, 100);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // If user is authenticated, redirect to /home
  if (isAuthenticated && !isLoading) {
    return <Navigate to="/home" replace />;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="home-page">
      <header className={scrolled ? 'scrolled' : ''}>
        <div className="container">
          <div className="navbar simplified">
            <div className="logo">
              <h2>DocChat AI</h2>
            </div>
            <div className="auth-buttons">
              <a href="http://localhost:3001/login" className="btn btn-primary">
                <i className="fas fa-sign-in-alt"></i> Login
              </a>
            </div>
          </div>
        </div>
      </header>

      <section className="hero">
        {/* Floating document elements */}
        <div className="hero-document">
          <div className="text-line text-line-1"></div>
          <div className="text-line text-line-2"></div>
          <div className="text-line text-line-3"></div>
          <div className="text-line text-line-4"></div>
        </div>
        <div className="hero-document">
          <div className="text-line text-line-1"></div>
          <div className="text-line text-line-2"></div>
          <div className="text-line text-line-3"></div>
        </div>
        <div className="hero-document">
          <div className="text-line text-line-1"></div>
          <div className="text-line text-line-2"></div>
        </div>
        <div className="hero-document">
          <div className="text-line text-line-1"></div>
          <div className="text-line text-line-2"></div>
          <div className="text-line text-line-3"></div>
        </div>
        <div className="hero-document">
          <div className="text-line text-line-1"></div>
          <div className="text-line text-line-2"></div>
          <div className="text-line text-line-3"></div>
          <div className="text-line text-line-4"></div>
        </div>
        
        <div className="container hero-content">
          <div className="company-title animate-fade-in">
            <h1 className="company-name">Gallega Soft's</h1>
            <h2 className="app-name">DocChat AI</h2>
          </div>
          <p className="animate-fade-in">Unlock the power of AI-driven document analysis with our cutting-edge platform. Experience seamless interaction with your documents.</p>
          <a href="http://localhost:3001/login" className="btn btn-outline animate-fade-in">
            Get Started <i className="fas fa-arrow-right"></i>
          </a>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <div className="section-title">
            <h2>Enterprise Solutions</h2>
            <p>Discover how our AI-powered platform revolutionizes document management and analysis</p>
          </div>
          <div className="features-grid" ref={featuresRef}>
            <div className="feature-card ai-models">
              <div className="feature-icon">
                <i className="fas fa-brain"></i>
              </div>
              <h3>Advanced AI Models</h3>
              <p>Harness the power of state-of-the-art language models including GPT-4, Claude, and Llama for unparalleled document understanding.</p>
              
              {/* Circuit board and AI model nodes */}
              <div className="circuit-container">
                <div className="circuit-line circuit-line-1"></div>
                <div className="circuit-line circuit-line-2"></div>
                <div className="circuit-line circuit-line-3"></div>
                <div className="circuit-line circuit-line-4"></div>
                <div className="circuit-line circuit-line-5"></div>
                <div className="circuit-line circuit-line-6"></div>
                <div className="circuit-line circuit-line-7"></div>
              </div>
              
              <div className="ai-model-node node-gpt">GPT-4</div>
              <div className="ai-model-node node-claude">Claude 3</div>
              <div className="ai-model-node node-llama">Llama 3</div>
              <div className="ai-model-node node-mistral">Mistral</div>
              <div className="ai-model-node node-falcon">Falcon</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-shield-alt"></i>
              </div>
              <h3>Enterprise Security</h3>
              <p>Bank-grade security with AWS S3 integration, end-to-end encryption, and comprehensive access controls for your sensitive documents.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-search"></i>
              </div>
              <h3>Intelligent Retrieval</h3>
              <p>Advanced retrieval algorithms ensure the most relevant parts of your documents are used to generate accurate responses.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-chart-line"></i>
              </div>
              <h3>Interactive Dashboard</h3>
              <p>Monitor usage, track conversations, and manage your document repository with our intuitive dashboard.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-file-alt"></i>
              </div>
              <h3>Multiple File Formats</h3>
              <p>Support for PDF, DOCX, TXT, CSV, and more - upload virtually any text-based document to chat with it instantly.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-lock"></i>
              </div>
              <h3>AWS Cognito Security</h3>
              <p>Industry-leading authentication powered by AWS Cognito ensures your data remains secure and private.</p>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="footer-content">
            <div className="footer-column">
              <h3>Gallega Soft</h3>
              <ul className="footer-links">
                <li><Link to="/about">About Us</Link></li>
                <li><Link to="/blog">Blog</Link></li>
                <li><Link to="/careers">Careers</Link></li>
                <li><Link to="/press">Press</Link></li>
              </ul>
            </div>
            <div className="footer-column">
              <h3>Features</h3>
              <ul className="footer-links">
                <li><Link to="/document-chat">Document Chat</Link></li>
                <li><Link to="/llm-support">Multi-LLM Support</Link></li>
                <li><Link to="/secure-storage">Secure Storage</Link></li>
                <li><Link to="/analytics">Analytics</Link></li>
              </ul>
            </div>
            <div className="footer-column">
              <h3>Resources</h3>
              <ul className="footer-links">
                <li><Link to="/docs">Documentation</Link></li>
                <li><Link to="/api">API</Link></li>
                <li><Link to="/community">Community</Link></li>
                <li><Link to="/support">Support</Link></li>
              </ul>
            </div>
            <div className="footer-column">
              <h3>Legal</h3>
              <ul className="footer-links">
                <li><Link to="/privacy">Privacy Policy</Link></li>
                <li><Link to="/terms">Terms of Service</Link></li>
                <li><Link to="/cookies">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} Gallega Soft. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HomePage; 