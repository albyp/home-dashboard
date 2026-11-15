import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

// Two pages, split so the kiosk doesn't load the admin page (and its fonts).
// The server decides who may open which: a kiosk session only reaches /kiosk.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const Kiosk = lazy(() => import('./kiosk/Kiosk.jsx'));

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function Root() {
  const path = usePath();
  return (
    <Suspense fallback={null}>
      {path.startsWith('/kiosk') ? <Kiosk /> : <AdminApp path={path} />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
