// Run the dashboard with example data and the built client:
//   cd client && npm run build && cd ../server && npm run demo
// Log in with "admin" (overview) or "kiosk" (family screen).
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DEMO = '1';
process.env.NODE_ENV = 'development';
process.env.PORT ||= '3001';
process.env.PUBLIC_DIR ||= path.join(here, '../../client/dist');
process.env.DASHBOARD_CONFIG ||= path.join(here, '../../dashboard.example.yaml');

await import('../index.js');
