'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Tag, stockApi } from '@/lib/api';

interface TagContextType {
  tags: Tag[];
  loading: boolean;
  error: string | null;
  refetchTags: () => Promise<void>;
}

const TagContext = createContext<TagContextType | undefined>(undefined);

export function TagProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTags = async () => {
    try {
      setLoading(true);
      setError(null);
      const { tags: fetchedTags } = await stockApi.getTags();
      setTags(fetchedTags);
    } catch (err) {
      console.error('Error fetching tags:', err);
      setError('Failed to fetch tags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const refetchTags = async () => {
    await fetchTags();
  };

  return (
    <TagContext.Provider value={{ tags, loading, error, refetchTags }}>
      {children}
    </TagContext.Provider>
  );
}

export function useTags() {
  const context = useContext(TagContext);
  if (context === undefined) {
    throw new Error('useTags must be used within a TagProvider');
  }
  return context;
}
