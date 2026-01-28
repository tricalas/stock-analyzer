'use client';

import React, { createContext, useContext, ReactNode, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, stockApi } from '@/lib/api';

interface TagContextType {
  tags: Tag[];
  loading: boolean;
  error: string | null;
  refetchTags: () => Promise<void>;
}

const TagContext = createContext<TagContextType | undefined>(undefined);

export function TagProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const { tags } = await stockApi.getTags();
      return tags;
    },
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 30 * 60 * 1000,    // 30 minutes (garbage collection time)
  });

  const refetchTags = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
  }, [queryClient]);

  return (
    <TagContext.Provider
      value={{
        tags: data || [],
        loading: isLoading,
        error: error ? 'Failed to fetch tags' : null,
        refetchTags,
      }}
    >
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
