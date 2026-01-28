'use client';

import { useState } from 'react';
import { Plus, Edit2, Trash2, Save, X, Loader2 } from 'lucide-react';
import { stockApi, Tag } from '@/lib/api';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function TagsManagement() {
  const { tags, loading: isLoading, refetchTags } = useTags();
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState({
    name: '',
    display_name: '',
    color: 'primary',
    icon: 'Tag',
    order: 0,
  });
  const [editForm, setEditForm] = useState({
    name: '',
    display_name: '',
    color: 'primary',
    icon: 'Tag',
    order: 0,
  });

  const iconOptions = ['Star', 'ThumbsDown', 'ShoppingCart', 'ThumbsUp', 'Eye', 'TrendingUp', 'Tag'];
  const colorOptions = [
    { value: 'primary', label: '파란색' },
    { value: 'gain', label: '초록색' },
    { value: 'loss', label: '빨간색' },
    { value: 'muted', label: '회색' },
  ];

  const handleAddTag = async () => {
    if (!newTag.name || !newTag.display_name) {
      toast.error('태그 이름과 표시 이름을 입력해주세요.');
      return;
    }

    try {
      await stockApi.createTag(newTag);
      toast.success('태그가 추가되었습니다.');
      setIsAdding(false);
      setNewTag({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
      await refetchTags();
    } catch (error) {
      console.error('Error creating tag:', error);
      toast.error('태그 추가에 실패했습니다.');
    }
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewTag({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
  };

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setEditForm({
      name: tag.name,
      display_name: tag.display_name,
      color: tag.color || 'primary',
      icon: tag.icon || 'Tag',
      order: tag.order || 0,
    });
  };

  const handleUpdateTag = async () => {
    if (!editingTag) return;

    if (!editForm.name || !editForm.display_name) {
      toast.error('태그 이름과 표시 이름을 입력해주세요.');
      return;
    }

    try {
      await stockApi.updateTag(editingTag.id, editForm);
      toast.success('태그가 수정되었습니다.');
      setEditingTag(null);
      await refetchTags();
    } catch (error) {
      console.error('Error updating tag:', error);
      toast.error('태그 수정에 실패했습니다.');
    }
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditForm({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
  };

  const handleDeleteTag = async (tag: Tag) => {
    if (!confirm(`"${tag.display_name}" 태그를 삭제하시겠습니까? 이 태그가 할당된 모든 종목에서 제거됩니다.`)) {
      return;
    }

    try {
      await stockApi.deleteTag(tag.id);
      toast.success('태그가 삭제되었습니다.');
      await refetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast.error('태그 삭제에 실패했습니다.');
    }
  };

  const getColorClass = (color?: string) => {
    switch (color) {
      case 'gain':
        return 'bg-gain text-gain-foreground';
      case 'primary':
        return 'bg-primary text-primary-foreground';
      case 'loss':
        return 'bg-loss text-loss-foreground';
      case 'muted':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-primary text-primary-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">태그 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">
            종목을 분류하기 위한 태그를 관리합니다.
          </p>
        </div>
        <Button onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-2" />
          태그 추가
        </Button>
      </div>

      {/* Tags List */}
      <Card>
        {isLoading ? (
          <CardContent className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">로딩 중...</span>
          </CardContent>
        ) : (
          <div className="divide-y divide-border">
            {/* Add New Tag Form */}
            {isAdding && (
              <CardContent className="pt-6 bg-muted/30">
                <h3 className="text-lg font-semibold mb-4">새 태그 추가</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>태그 이름 (영문)</Label>
                    <Input
                      value={newTag.name}
                      onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                      placeholder="예: my_tag"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>표시 이름</Label>
                    <Input
                      value={newTag.display_name}
                      onChange={(e) => setNewTag({ ...newTag, display_name: e.target.value })}
                      placeholder="예: 내 태그"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>색상</Label>
                    <Select
                      value={newTag.color}
                      onValueChange={(value) => setNewTag({ ...newTag, color: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {colorOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>아이콘</Label>
                    <Select
                      value={newTag.icon}
                      onValueChange={(value) => setNewTag({ ...newTag, icon: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {iconOptions.map((icon) => (
                          <SelectItem key={icon} value={icon}>{icon}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>순서</Label>
                    <Input
                      type="number"
                      value={newTag.order}
                      onChange={(e) => setNewTag({ ...newTag, order: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={handleAddTag}>
                    <Save className="h-4 w-4 mr-2" />
                    저장
                  </Button>
                  <Button variant="outline" onClick={handleCancelAdd}>
                    <X className="h-4 w-4 mr-2" />
                    취소
                  </Button>
                </div>
              </CardContent>
            )}

            {/* Tags List */}
            {tags.map((tag) => (
              <div key={tag.id} className="p-6 hover:bg-muted/30 transition-colors">
                {editingTag?.id === tag.id ? (
                  /* Edit Form */
                  <div>
                    <h3 className="text-lg font-semibold mb-4">태그 수정</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>태그 이름 (영문)</Label>
                        <Input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>표시 이름</Label>
                        <Input
                          value={editForm.display_name}
                          onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>색상</Label>
                        <Select
                          value={editForm.color}
                          onValueChange={(value) => setEditForm({ ...editForm, color: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {colorOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>아이콘</Label>
                        <Select
                          value={editForm.icon}
                          onValueChange={(value) => setEditForm({ ...editForm, icon: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {iconOptions.map((icon) => (
                              <SelectItem key={icon} value={icon}>{icon}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>순서</Label>
                        <Input
                          type="number"
                          value={editForm.order}
                          onChange={(e) => setEditForm({ ...editForm, order: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button onClick={handleUpdateTag}>
                        <Save className="h-4 w-4 mr-2" />
                        저장
                      </Button>
                      <Button variant="outline" onClick={handleCancelEdit}>
                        <X className="h-4 w-4 mr-2" />
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Normal View */
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className={cn("px-3 py-1.5 rounded-lg font-semibold", getColorClass(tag.color))}>
                        {tag.display_name}
                      </span>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-mono">{tag.name}</span>
                        <span className="mx-2">|</span>
                        <span>아이콘: {tag.icon}</span>
                        <span className="mx-2">|</span>
                        <span>순서: {tag.order}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(tag)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTag(tag)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
