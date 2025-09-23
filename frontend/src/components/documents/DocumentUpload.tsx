// wmlab/frontend/components/documents/DocumentUpload.tsx
'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
  documentId?: string;
}

interface DocumentMetadata {
  title: string;
  description: string;
  category: string;
  tags: string[];
  departmentId?: string;
  warehouseId: string;
  language: 'en' | 'ar' | 'de';
  isPublic: boolean;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

export default function DocumentUpload() {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [metadata, setMetadata] = useState<DocumentMetadata>({
    title: '',
    description: '',
    category: 'Other',
    tags: [],
    warehouseId: '',
    language: 'en',
    isPublic: false,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const { toast } = useToast();
  const { user } = useAuthStore();

  // Mock data - in production, fetch from API
  const warehouses: Warehouse[] = [
    { id: 'wh-1', name: 'Main Warehouse', code: 'MW001' },
    { id: 'wh-2', name: 'Distribution Center A', code: 'DC-A' },
    { id: 'wh-3', name: 'Distribution Center B', code: 'DC-B' },
  ];

  const departments: Department[] = [
    { id: 'dept-1', name: 'Receiving', code: 'RCV' },
    { id: 'dept-2', name: 'Shipping', code: 'SHP' },
    { id: 'dept-3', name: 'Quality Control', code: 'QC' },
    { id: 'dept-4', name: 'Inventory', code: 'INV' },
  ];

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle accepted files
    const newFiles: UploadFile[] = acceptedFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      status: 'pending' as const,
      progress: 0,
    }));

    setFiles(prev => [...prev, ...newFiles]);

    // Handle rejected files
    if (rejectedFiles.length > 0) {
      const errors = rejectedFiles.map(rejection => {
        const error = rejection.errors[0];
        if (error.code === 'file-too-large') {
          return `${rejection.file.name}: File is too large (max 50MB)`;
        } else if (error.code === 'file-invalid-type') {
          return `${rejection.file.name}: Invalid file type`;
        } else {
          return `${rejection.file.name}: ${error.message}`;
        }
      }).join(', ');

      toast({
        title: 'Some files were rejected',
        description: errors,
        variant: 'destructive',
      });
    }
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'text/plain': ['.txt'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: true,
  });

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const addTag = () => {
    if (tagInput.trim() && !metadata.tags.includes(tagInput.trim())) {
      setMetadata(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setMetadata(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag),
    }));
  };

  const uploadFiles = async () => {
    if (!metadata.title || !metadata.warehouseId) {
      toast({
        title: 'Missing Information',
        description: 'Please provide title and warehouse',
        variant: 'destructive',
      });
      return;
    }

    if (files.length === 0) {
      toast({
        title: 'No Files',
        description: 'Please select files to upload',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    
    for (const uploadFile of files) {
      if (uploadFile.status !== 'pending') continue;

      try {
        // Update status to uploading
        setFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? { ...f, status: 'uploading', progress: 0 }
              : f
          )
        );

        // Prepare form data
        const formData = new FormData();
        formData.append('file', uploadFile.file);
        
        // Add metadata
        formData.append('title', metadata.title);
        formData.append('description', metadata.description || '');
        formData.append('category', metadata.category);
        formData.append('warehouseId', metadata.warehouseId);
        formData.append('language', metadata.language);
        formData.append('isPublic', metadata.isPublic.toString());
        
        if (metadata.departmentId) {
          formData.append('departmentId', metadata.departmentId);
        }
        
        if (metadata.tags.length > 0) {
          formData.append('tags', JSON.stringify(metadata.tags));
        }

        // Upload file with progress tracking
        const response = await api.post('/documents/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            const progress = progressEvent.total
              ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
              : 0;
            setFiles(prev =>
              prev.map(f =>
                f.id === uploadFile.id ? { ...f, progress } : f
              )
            );
          },
        });

        // Update status to processing
        setFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? { 
                  ...f, 
                  status: 'processing', 
                  progress: 100, 
                  documentId: response.data.document.id 
                }
              : f
          )
        );

        // Poll for processing status
        await pollProcessingStatus(uploadFile.id, response.data.document.id);

      } catch (error: any) {
        console.error('Upload error:', error);
        setFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id
              ? { 
                  ...f, 
                  status: 'error', 
                  error: error.response?.data?.error || 'Upload failed' 
                }
              : f
          )
        );
      }
    }

    setIsUploading(false);
    
    // Check if all files were successfully uploaded
    const successfulUploads = files.filter(f => f.status === 'completed').length;
    const failedUploads = files.filter(f => f.status === 'error').length;
    
    if (successfulUploads > 0) {
      toast({
        title: 'Upload Complete',
        description: `${successfulUploads} file(s) uploaded successfully${failedUploads > 0 ? `, ${failedUploads} failed` : ''}`,
      });
    }
  };

  const pollProcessingStatus = async (fileId: string, documentId: string) => {
    let attempts = 0;
    const maxAttempts = 30; // 60 seconds max (2s intervals)
    
    const pollInterval = setInterval(async () => {
      attempts++;
      
      try {
        const response = await api.get(`/documents/upload/progress/${documentId}`);
        const { status, progress, error } = response.data;

        if (status === 'completed') {
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? { ...f, status: 'completed', progress: 100 }
                : f
            )
          );
          clearInterval(pollInterval);
        } else if (status === 'failed') {
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? { ...f, status: 'error', error: error || 'Processing failed' }
                : f
            )
          );
          clearInterval(pollInterval);
        } else {
          // Update processing progress
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? { ...f, progress: progress || 0 }
                : f
            )
          );
        }
        
        // Stop polling after max attempts
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? { ...f, status: 'error', error: 'Processing timeout' }
                : f
            )
          );
        }
      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(pollInterval);
        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'error', error: 'Failed to check status' }
              : f
          )
        );
      }
    }, 2000); // Poll every 2 seconds
  };

  const getFileIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4" />;
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusColor = (status: UploadFile['status']) => {
    switch (status) {
      case 'pending':
        return 'default';
      case 'uploading':
        return 'secondary';
      case 'processing':
        return 'secondary';
      case 'completed':
        return 'success';
      case 'error':
        return 'destructive';
      default:
        return 'default';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const clearAll = () => {
    setFiles([]);
    setMetadata({
      title: '',
      description: '',
      category: 'Other',
      tags: [],
      warehouseId: '',
      language: 'en',
      isPublic: false,
    });
    setTagInput('');
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">Upload Documents</h2>
        
        {/* Metadata Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={metadata.title}
              onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
              placeholder="Document title"
              disabled={isUploading}
            />
          </div>
          
          <div>
            <Label htmlFor="category">Category *</Label>
            <Select
              value={metadata.category}
              onValueChange={(value) => setMetadata({ ...metadata, category: value })}
              disabled={isUploading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SOPs">SOPs</SelectItem>
                <SelectItem value="Safety">Safety</SelectItem>
                <SelectItem value="Equipment">Equipment</SelectItem>
                <SelectItem value="Training">Training</SelectItem>
                <SelectItem value="Reports">Reports</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="warehouse">Warehouse *</Label>
            <Select
              value={metadata.warehouseId}
              onValueChange={(value) => setMetadata({ ...metadata, warehouseId: value })}
              disabled={isUploading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="department">Department</Label>
            <Select
              value={metadata.departmentId}
              onValueChange={(value) => setMetadata({ ...metadata, departmentId: value })}
              disabled={isUploading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department (optional)" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name} ({dept.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="language">Language</Label>
            <Select
              value={metadata.language}
              onValueChange={(value: 'en' | 'ar' | 'de') => 
                setMetadata({ ...metadata, language: value })}
              disabled={isUploading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 mt-6">
            <Checkbox
              id="isPublic"
              checked={metadata.isPublic}
              onCheckedChange={(checked) => 
                setMetadata({ ...metadata, isPublic: checked as boolean })}
              disabled={isUploading}
            />
            <Label htmlFor="isPublic" className="font-normal cursor-pointer">
              Make this document public (accessible to all warehouse workers)
            </Label>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={metadata.description}
              onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
              placeholder="Brief description of the document"
              rows={3}
              disabled={isUploading}
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2 mb-2">
              <Input
                id="tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tags (press Enter)"
                disabled={isUploading}
              />
              <Button 
                type="button" 
                onClick={addTag}
                disabled={isUploading}
              >
                Add Tag
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {metadata.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="py-1">
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-2 hover:text-red-500"
                    disabled={isUploading}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors duration-200
            ${isDragActive 
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' 
              : 'border-gray-300 dark:border-gray-700 hover:border-gray-400'
            }
            ${isUploading ? 'pointer-events-none opacity-50' : ''}
          `}
        >
          <input {...getInputProps()} disabled={isUploading} />
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          {isDragActive ? (
            <p>Drop the files here...</p>
          ) : (
            <>
              <p className="text-lg mb-2">Drag & drop files here, or click to select</p>
              <p className="text-sm text-gray-500">
                Supports PDF, Word, Excel, PowerPoint, Text, and Images (max 50MB per file)
              </p>
            </>
          )}
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">Files ({files.length})</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={isUploading}
              >
                Clear All
              </Button>
            </div>
            
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div className="flex items-center space-x-3 flex-1">
                  {getFileIcon(file.status)}
                  <div className="flex-1">
                    <p className="font-medium">{file.file.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(file.file.size)}
                    </p>
                    {file.error && (
                      <p className="text-sm text-red-500 mt-1">{file.error}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Badge variant={getStatusColor(file.status) as any}>
                    {file.status}
                  </Badge>
                  
                  {(file.status === 'uploading' || file.status === 'processing') && (
                    <div className="w-32">
                      <Progress value={file.progress} />
                      <p className="text-xs text-gray-500 mt-1 text-center">
                        {file.progress}%
                      </p>
                    </div>
                  )}
                  
                  {file.status === 'pending' && !isUploading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Upload Button */}
        {files.length > 0 && (
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={clearAll}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={uploadFiles}
              disabled={isUploading || files.every(f => f.status !== 'pending')}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload {files.filter(f => f.status === 'pending').length} File(s)
                </>
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}