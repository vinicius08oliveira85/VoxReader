import React from 'react';
import { useApp } from './context/AppContext';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { AudioPlayer } from './components/AudioPlayer';
import { Settings } from './components/Settings';

function App() {
  const { state, actions } = useApp();
  const { view, isLoading, error } = state;

  if (isLoading && !state.currentBook) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-secondary/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-accent-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Erro</h2>
          <p className="text-text-muted mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-bg-primary rounded-lg font-medium transition-colors"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (view) {
      case 'reader':
        return <Reader />;
      case 'settings':
        return <Settings />;
      case 'player':
        return <Library />;
      default:
        return <Library />;
    }
  };

  return (
    <>
      {renderView()}
      {state.currentBook && (
        <AudioPlayer />
      )}
    </>
  );
}

export default App;