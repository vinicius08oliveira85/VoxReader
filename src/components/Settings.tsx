import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { TTSEngine } from '../types';

export function Settings() {
  const { state, actions } = useApp();
  const { settings } = state;
  const [apiKey, setApiKey] = useState(settings.geminiApiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<'engine' | 'storage'>('engine');

  const handleApiKeySave = async () => {
    await actions.updateSettings({ geminiApiKey: apiKey });
  };

  const engines: { id: TTSEngine; name: string; description: string }[] = [
    { id: 'gemini', name: 'Gemini Audio', description: 'Qualidade premium da Google' },
    { id: 'kokoro', name: 'Kokoro (WebGPU)', description: 'Local, offline, sem consumo de API' },
    { id: 'edge', name: 'Edge Neural TTS', description: 'Vozes da Microsoft diretamente no navegador' }
  ];

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="bg-bg-secondary border-b border-border-light sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => actions.setView('library')}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary transition-colors"
              aria-label="Voltar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
            <h1 className="text-xl font-bold text-text-primary">Configurações</h1>
            <div className="w-10" />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as any)}
            className="px-3 py-2 bg-bg-secondary border border-border-light rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="engine">Motor de Voz</option>
            <option value="storage">Armazenamento</option>
          </select>
        </div>

        {activeTab === 'engine' && (
          <div className="space-y-6">
            <div className="bg-bg-secondary border border-border-light rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Motor de Voz</h2>
              <p className="text-sm text-text-muted mb-4">
                Selecione o motor de síntese de voz preferido. O app fará fallback automático se o motor primário falhar.
              </p>

              <div className="space-y-3">
                {engines.map((engine) => (
                  <label
                    key={engine.id}
                    className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      settings.preferredEngine === engine.id
                        ? 'border-accent-primary bg-accent-primary/5'
                        : 'border-border-light hover:border-accent-primary/50 bg-bg-tertiary'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        engine.id === 'gemini' ? 'bg-accent-tertiary/10 text-accent-secondary' :
                        engine.id === 'kokoro' ? 'bg-accent-secondary/10 text-accent-secondary' :
                        'bg-accent-primary/10 text-accent-primary'
                      }`}>
                        {engine.id === 'gemini' ? 'G' : engine.id === 'kokoro' ? 'K' : 'E'}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-text-primary">{engine.name}</span>
                          <input
                            type="radio"
                            name="engine"
                            value={engine.id}
                            checked={settings.preferredEngine === engine.id}
                            onChange={() => actions.updateSettings({ preferredEngine: engine.id })}
                            className="accent-accent-primary"
                          />
                        </div>
                        <p className="text-sm text-text-muted">{engine.description}</p>
                        {engine.id === 'gemini' && (
                          <button
                            onClick={() => actions.preloadEngine('gemini')}
                            className="mt-2 text-xs text-accent-primary hover:text-accent-tertiary transition-colors"
                          >
                            Precarregar modelo
                          </button>
                        )}
                        {engine.id === 'kokoro' && (
                          <button
                            onClick={() => actions.preloadEngine('kokoro')}
                            className="mt-2 text-xs text-accent-primary hover:text-accent-tertiary transition-colors"
                          >
                            Precarregar modelo
                          </button>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {settings.preferredEngine === 'gemini' && (
              <div className="bg-bg-secondary border border-border-light rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-text-primary mb-4">API Key do Gemini</h2>
                <p className="text-sm text-text-muted mb-4">
                  Obtenha sua chave em{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">
                    Google AI Studio
                  </a>
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Cole sua API Key aqui..."
                      className="w-full px-3 py-2 bg-bg-tertiary border border-border-light rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showApiKey ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <button
                    onClick={handleApiKeySave}
                    className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-bg-primary rounded-lg font-medium transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="space-y-6">
            <div className="bg-bg-secondary border border-border-light rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Armazenamento</h2>
              <p className="text-sm text-text-muted mb-4">
                Áudios gerados são salvos localmente no IndexedDB para reprodução offline.
              </p>
              
              <div className="space-y-4">
                <button
                  onClick={() => {}}
                  className="w-full px-4 py-3 bg-bg-tertiary hover:bg-bg-hover text-text-primary rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.187 12a2 2 0 01-1.812 2H6.997a2 2 0 01-1.812-2L5.187 7M6 7V3a1 1 0 011-1h10a1 1 0 011 1v4M6 7l1.5 12h11L20 7M6 7h12"/>
                  </svg>
                  Limpar todo o cache de áudio
                </button>
                
                <p className="text-xs text-text-muted">
                  Isso removerá todos os áudios gerados. Você precisará gerar novamente.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}