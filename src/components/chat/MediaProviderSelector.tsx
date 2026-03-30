'use client';

import { useEffect, useState } from 'react';
import { useImageGen } from '@/hooks/useImageGen';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MediaProviderOption {
  id: string;
  name: string;
  provider_type: string;
}

export function MediaProviderSelector() {
  const { state, mediaProviderId, setMediaProviderId } = useImageGen();
  const [options, setOptions] = useState<MediaProviderOption[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/providers', { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((data: { providers?: Array<{ id: string; name: string; provider_type: string }> } | null) => {
        if (!data?.providers) return;
        const media = data.providers.filter(
          p => p.provider_type === 'gemini-image' || p.provider_type === 'minimax-media',
        );
        setOptions(media);
        if (media.length > 0 && !mediaProviderId) {
          setMediaProviderId(media[0].id);
        }
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') { /* ignore */ } });
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only show when Design Agent is enabled and there are media providers
  if (!state.enabled || options.length === 0) return null;

  return (
    <Select
      value={mediaProviderId ?? options[0]?.id ?? ''}
      onValueChange={setMediaProviderId}
    >
      <SelectTrigger className="h-7 text-xs border-border/60 bg-transparent px-2 min-w-[120px] max-w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(p => (
          <SelectItem key={p.id} value={p.id} className="text-xs">
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
