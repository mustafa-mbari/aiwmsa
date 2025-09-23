// C:\Dev\Git\AIwmsa\frontend\src\app\dashboard\search\page.tsx
'use client';

import { useState } from 'react';
import {
  Search,
  Mic,
  Filter,
  FileText,
  Clock,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Loader2,
  AlertCircle,
  Sparkles,
  Globe,
} from 'lucide-react';
import { format } from 'date-fns';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  source: string;
  relevance: number;
  documentType: string;
  lastUpdated: Date;
  highlights: string[];
}

// Mock search results for demonstration
const mockResults: SearchResult[] = [
  {
    id: '1',
    title: 'Forklift Operation Safety Guidelines',
    content: 'Complete safety procedures for operating forklifts in warehouse environments. Always perform pre-operation inspection, check for obstacles, and maintain safe speed limits...',
    source: 'safety_manual_2024.pdf',
    relevance: 0.95,
    documentType: 'PDF',
    lastUpdated: new Date('2024-01-15'),
    highlights: ['forklift', 'safety', 'operation'],
  },
  {
    id: '2',
    title: 'Emergency Evacuation Procedures',
    content: 'In case of emergency, follow these evacuation procedures: 1. Sound the alarm, 2. Guide personnel to nearest exit, 3. Assemble at designated meeting point...',
    source: 'emergency_procedures.docx',
    relevance: 0.82,
    documentType: 'DOCX',
    lastUpdated: new Date('2024-02-10'),
    highlights: ['emergency', 'evacuation', 'procedures'],
  },
  {
    id: '3',
    title: 'Inventory Management Best Practices',
    content: 'Effective inventory management includes regular cycle counts, proper labeling, FIFO/LIFO methods, and maintaining accurate records in the WMS system...',
    source: 'inventory_guide.pdf',
    relevance: 0.78,
    documentType: 'PDF',
    lastUpdated: new Date('2024-01-20'),
    highlights: ['inventory', 'management', 'WMS'],