'use client';

import { useState } from 'react';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { stockApi, Tag } from '@/lib/api';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';

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
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">태그 관리</h1>
            <p className="text-sm text-muted-foreground mt-1">
              종목을 분류하기 위한 태그를 관리합니다.
            </p>
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            태그 추가
          </button>
        </div>

        {/* Tags List */}
        <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="text-center py-24">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
              <p className="mt-4 text-sm text-muted-foreground">Loading tags...</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Add New Tag Form */}
              {isAdding && (
                <div className="p-6 bg-muted/30">
                  <h3 className="text-lg font-semibold mb-4">새 태그 추가</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">태그 이름 (영문)</label>
                      <input
                        type="text"
                        value={newTag.name}
                        onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                        placeholder="예: my_tag"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">표시 이름</label>
                      <input
                        type="text"
                        value={newTag.display_name}
                        onChange={(e) => setNewTag({ ...newTag, display_name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                        placeholder="예: 내 태그"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">색상</label>
                      <select
                        value={newTag.color}
                        onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      >
                        {colorOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">아이콘</label>
                      <select
                        value={newTag.icon}
                        onChange={(e) => setNewTag({ ...newTag, icon: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      >
                        {iconOptions.map((icon) => (
                          <option key={icon} value={icon}>{icon}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">순서</label>
                      <input
                        type="number"
                        value={newTag.order}
                        onChange={(e) => setNewTag({ ...newTag, order: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handleAddTag}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                      <Save className="h-4 w-4" />
                      저장
                    </button>
                    <button
                      onClick={handleCancelAdd}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                    >
                      <X className="h-4 w-4" />
                      취소
                    </button>
                  </div>
                </div>
              )}

              {/* Tags List */}
              {tags.map((tag) => (
                <div key={tag.id} className="p-6 hover:bg-muted/30 transition-colors">
                  {editingTag?.id === tag.id ? (
                    /* Edit Form */
                    <div>
                      <h3 className="text-lg font-semibold mb-4">태그 수정</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">태그 이름 (영문)</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">표시 이름</label>
                          <input
                            type="text"
                            value={editForm.display_name}
                            onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">색상</label>
                          <select
                            value={editForm.color}
                            onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          >
                            {colorOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">아이콘</label>
                          <select
                            value={editForm.icon}
                            onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          >
                            {iconOptions.map((icon) => (
                              <option key={icon} value={icon}>{icon}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">순서</label>
                          <input
                            type="number"
                            value={editForm.order}
                            onChange={(e) => setEditForm({ ...editForm, order: parseInt(e.target.value) })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={handleUpdateTag}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                        >
                          <Save className="h-4 w-4" />
                          저장
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                        >
                          <X className="h-4 w-4" />
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Normal View */
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className={`px-3 py-1.5 rounded-lg font-semibold ${getColorClass(tag.color)}`}>
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(tag)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors"
                          title="편집"
                        >
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag)}
                          className="p-2 hover:bg-destructive/10 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
