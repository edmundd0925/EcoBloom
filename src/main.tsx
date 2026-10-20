import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Person3Dashboard from './person3/Person3Dashboard';
import './styles.css';
import './person3/route-nav.css';

// Query-based view switch: keeps your teammates' original App and its 3D park.
// No routing package or Vercel rewrite rules are required.
const isDashboard = new URLSearchParams(window.location.search).get('dashboard') === 'person3';

function EcoBloomWebsite() {
  return (
    <>
      {isDashboard ? <Person3Dashboard /> : <App />}
      <nav className="ecobloom-view-switch" aria-label="EcoBloom views">
        <a href="/" className={!isDashboard ? 'ecobloom-view-active' : ''} aria-current={!isDashboard ? 'page' : undefined}>
          Original park
        </a>
        <a href="/?dashboard=person3" className={isDashboard ? 'ecobloom-view-active' : ''} aria-current={isDashboard ? 'page' : undefined}>
          Smart dashboard
        </a>
      </nav>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><EcoBloomWebsite /></React.StrictMode>
);
