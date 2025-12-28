import React from 'react';
import ReactDOM from 'react-dom/client';
import GetRecord from './get-record';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <GetRecord />
    </React.StrictMode>
  );
}

