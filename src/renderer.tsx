import { createRoot } from 'react-dom/client';
import 'reactflow/dist/style.css';
import App from './App';
import './styles/index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Renderer root element was not found.');
}

createRoot(container).render(<App />);