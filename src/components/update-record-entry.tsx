import React from 'react';
import ReactDOM from 'react-dom/client';
import UpdateRecord from './update-record';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <UpdateRecord />
    </React.StrictMode>
  );
}

