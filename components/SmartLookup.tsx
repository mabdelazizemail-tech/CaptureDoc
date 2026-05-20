import React, { useEffect, useState, useRef } from 'react';
import { Search, User, Building, Plus } from 'lucide-react';
import { getContacts, getCompanies, Contact, Company } from '../services/crmService';

export type SmartLookupResult = 
  | { type: 'contact'; contact: Contact }
  | { type: 'company'; company: Company }
  | { type: 'new_contact'; firstName: string; lastName: string }
  | { type: 'new_company'; name: string };

interface SmartLookupProps {
  onSelect: (result: SmartLookupResult) => void;
  placeholder?: string;
  className?: string;
}

export default function SmartLookup({ onSelect, placeholder = 'Search existing contacts or companies...', className = '' }: SmartLookupProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load data on focus/mount
  useEffect(() => {
    async function loadLookupData() {
      setLoading(true);
      try {
        const [contactsData, companiesData] = await Promise.all([
          getContacts(),
          getCompanies()
        ]);
        setContacts(contactsData);
        setCompanies(companiesData);
      } catch (err) {
        console.error('Error fetching lookup data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadLookupData();
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter contacts and companies based on search query
  const cleanQuery = query.trim().toLowerCase();
  
  const filteredContacts = cleanQuery
    ? contacts.filter(c => 
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(cleanQuery) ||
        (c.company?.name || '').toLowerCase().includes(cleanQuery) ||
        (c.email || '').toLowerCase().includes(cleanQuery)
      ).slice(0, 5)
    : [];

  const filteredCompanies = cleanQuery
    ? companies.filter(c => 
        c.name.toLowerCase().includes(cleanQuery) ||
        (c.industry || '').toLowerCase().includes(cleanQuery)
      ).slice(0, 5)
    : [];

  // Generate results list
  const results: Array<
    | { id: string; name: string; subtitle: string; type: 'contact'; original: Contact }
    | { id: string; name: string; subtitle: string; type: 'company'; original: Company }
    | { id: string; name: string; subtitle: string; type: 'new_contact'; query: string }
    | { id: string; name: string; subtitle: string; type: 'new_company'; query: string }
  > = [];

  // Add contact results
  filteredContacts.forEach(c => {
    results.push({
      id: `contact-${c.id}`,
      name: `${c.first_name} ${c.last_name}`,
      subtitle: c.company?.name ? `Contact at ${c.company.name}` : 'Independent Contact',
      type: 'contact',
      original: c
    });
  });

  // Add company results
  filteredCompanies.forEach(c => {
    results.push({
      id: `company-${c.id}`,
      name: c.name,
      subtitle: c.industry ? `Account · ${c.industry}` : 'Account / Company',
      type: 'company',
      original: c
    });
  });

  // Add inline quick-create options if query is not empty
  if (cleanQuery) {
    // Check if query looks like a full name (has space)
    const nameParts = query.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    results.push({
      id: 'create-new-contact',
      name: `Create new contact "${query.trim()}"`,
      subtitle: `Inline Contact Creation`,
      type: 'new_contact',
      query: query.trim()
    });

    results.push({
      id: 'create-new-company',
      name: `Create new company "${query.trim()}"`,
      subtitle: `Inline Account Creation`,
      type: 'new_company',
      query: query.trim()
    });
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < results.length) {
        selectItem(results[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const selectItem = (item: typeof results[number]) => {
    if (item.type === 'contact') {
      onSelect({ type: 'contact', contact: item.original });
    } else if (item.type === 'company') {
      onSelect({ type: 'company', company: item.original });
    } else if (item.type === 'new_contact') {
      const parts = item.query.split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || 'Contact';
      onSelect({ type: 'new_contact', firstName, lastName });
    } else if (item.type === 'new_company') {
      onSelect({ type: 'new_company', name: item.query });
    }
    setQuery('');
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full h-10 pl-10 pr-4 border-2 border-[var(--border)] rounded-[2px] bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors font-sans"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="size-4 rounded-full border border-[var(--primary)] border-t-transparent animate-spin"></div>
          </div>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[var(--card)] border-2 border-[var(--border)] rounded-[2px] shadow-lg max-h-72 overflow-y-auto z-50 divide-y divide-[var(--border)] animate-in fade-in slide-in-from-top-1 duration-150">
          {results.map((item, idx) => {
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`w-full px-4 py-2.5 text-left flex items-start gap-3 transition-colors ${
                  isHighlighted 
                    ? 'bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] border-l-4 border-[var(--primary)] pl-3' 
                    : 'border-l-4 border-transparent'
                }`}
              >
                <div className={`size-7 rounded-[2px] flex items-center justify-center shrink-0 ${
                  item.type === 'contact' ? 'bg-emerald-500/10 text-emerald-600' :
                  item.type === 'company' ? 'bg-amber-500/10 text-amber-600' : 'bg-zinc-500/10 text-zinc-600'
                }`}>
                  {item.type === 'contact' && <User className="size-3.5" />}
                  {item.type === 'company' && <Building className="size-3.5" />}
                  {(item.type === 'new_contact' || item.type === 'new_company') && <Plus className="size-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--foreground)] truncate">
                    {item.name}
                  </div>
                  <div className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mt-0.5">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
