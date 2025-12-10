/**
 * App Component
 * 
 * Root component that renders the ClientProcessor UI.
 */

import { ClientProcessor } from './components/ClientProcessor';
import './App.css';

function App() {
  return (
    <div className="app">
      <ClientProcessor />
    </div>
  );
}

export default App;

