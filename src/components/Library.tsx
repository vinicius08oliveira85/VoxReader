import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export function Library() {
  const { state, actions } = useApp();
  const { books, view } = state;
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredBooks = books.filter(book => 
    book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type === 'application/epub+zip' || file.name.endsWith('.epub')) {
        await actions.addBook(file);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      await actions.addBook(file);
    }
    e.target.value = '';
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <header className="bg-bg-secondary border-b border-border-light sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary to-accent-tertiary flex items-center justify-center">
                <svg className="w-6 h-6 text-bg-primary" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-text-primary">Audiobook IA</h1>
                <p className="text-xs text-text-muted">e-Pub para Audiobook Neural</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => actions.setView('settings')}
                className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary transition-colors"
                aria-label="Configurações"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <input
            type="text"
            placeholder="Buscar livros..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 bg-bg-secondary border border-border-light rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20 transition-all"
          />
        </div>

        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-2xl p-8 transition-all ${
            dragActive 
              ? 'border-accent-primary bg-accent-primary/5' 
              : 'border-border-light hover:border-accent-primary/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            onChange={handleFileSelect}
            className="absolute inset-0 opacity-0 cursor-pointer"
            multiple
          />
          
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            <p className="text-text-primary mb-2">Arraste um arquivo .epub aqui</p>
            <p className="text-text-muted">ou clique para selecionar</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-6 py-2 bg-accent-primary hover:bg-accent-primary/90 text-bg-primary rounded-lg font-medium transition-colors"
            >
              Selecionar Arquivo
            </button>
          </div>
        </div>

        {filteredBooks.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.132.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.132.477-4.5 1.253"/>
              </svg>
              Biblioteca ({filteredBooks.length})
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredBooks.map(book => (
                <BookCard key={book.id} book={book} onClick={() => actions.openBook(book.id)} />
              ))}
            </div>
          </div>
        }

        {filteredBooks.length === 0 && !dragActive && (
          <div className="mt-12 text-center">
            <svg className="w-24 h-24 mx-auto mb-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.132.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.132.477-4.5 1.253"/>
            </svg>
            <h3 className="text-xl text-text-primary mb-2">Nenhum livro na biblioteca</h3>
            <p className="text-text-muted">Adicione seu primeiro e-Pub para começar</p>
          </div>
        )}
      </main>
    </div>
  );
}

function BookCard({ book, onClick }: { book: any; onClick: () => void }) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <button
      onClick={onClick}
      className="group relative bg-bg-secondary border border-border-light rounded-2xl overflow-hidden hover:border-accent-primary/50 hover:shadow-xl hover:shadow-accent-primary/5 transition-all duration-300"
    >
      <div className="aspect-[3/4] bg-gradient-to-br from-bg-tertiary to-bg-secondary relative overflow-hidden">
        {book.cover ? (
          <img 
            src={URL.createObjectURL(book.cover)} 
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-bg-tertiary to-bg-secondary">
            <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.132.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.132.477-4.5 1.253"/>
            </svg>
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-bg-primary/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 translate-y-2 group-hover:translate-y-0">
          <button className="w-full px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-bg-primary rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            Continuar
          </button>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-text-primary truncate mb-1">{book.title}</h3>
        <p className="text-text-muted text-sm truncate">{book.author}</p>
        <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
          <span>{book.chapterCount} capítulos</span>
          <span>{formatDate(book.addedAt)}</span>
        </div>
      </div>
    </button>
  );
}