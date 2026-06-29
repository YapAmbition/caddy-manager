import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface RouteRule {
  id: string;
  matchPath: string;
  target: string;
  stripPrefix: boolean;
  headers?: { key: string; value: string }[];
  comment?: string;
}

interface Application {
  id: string;
  title: string;
  icon: {
    type: 'emoji' | 'image' | 'gradient';
    value: string;
  };
  iconText?: string;
  iconTextColor?: string;
  description?: string;
  routePath?: string;
  url?: string;
}

interface AppCardProps {
  app: Application;
  routes: RouteRule[];
  getRouteUrl: (path: string) => string;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dragHandle?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const AppCard = forwardRef<HTMLDivElement, AppCardProps>(
  ({ app, routes, getRouteUrl, onClick, onEdit, onDelete, dragHandle, className = '', style }, ref) => {
    const hasUrl = !!app.url?.trim();
    const boundRoute = routes.find(r => r.matchPath === app.routePath);
    const isUnbound = !hasUrl && !app.routePath;
    const isRouteMissing = !hasUrl && !!app.routePath && !boundRoute;

    return (
      <div
        ref={ref}
        style={style}
        className={`app-card ${isRouteMissing || isUnbound ? 'app-card-unbound' : ''} ${className}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      >
        {dragHandle && (
          <div className="app-card-drag-handle" title="拖动排序">
            {dragHandle}
          </div>
        )}
        <div className="app-card-actions">
          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit">✏️</button>
          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">🗑️</button>
        </div>
        <div className="app-card-icon">
          {app.icon.type === 'emoji' && <span className="app-icon-emoji">{app.icon.value}</span>}
          {app.icon.type === 'image' && <img src={app.icon.value} alt={app.title} className="app-icon-img" />}
          {app.icon.type === 'gradient' && (
            <div className="app-icon-gradient" style={{ background: `linear-gradient(135deg, ${app.icon.value.split(',')[0] || '#7DC395'}, ${app.icon.value.split(',')[1] || '#19c8b9'})` }}>
              {app.iconText && <span className="app-icon-text" style={{ color: app.iconTextColor || '#fff' }}>{app.iconText}</span>}
            </div>
          )}
        </div>
        <div className="app-card-info">
          <div className="app-card-title">{app.title}</div>
          {app.description && <div className="app-card-desc">{app.description}</div>}
          <div className="app-card-tags">
            {isUnbound && <span className="app-type-tag app-type-unbound" title="该应用未设置链接">未绑定</span>}
            {isRouteMissing && <span className="app-type-tag app-type-missing" title={`绑定的路由 ${app.routePath} 已不存在`}>路由失效</span>}
            {hasUrl && <span className="app-type-tag app-type-url" title={app.url}>自定义链接</span>}
            {boundRoute && !hasUrl && app.routePath && <span className="app-type-tag app-type-route" title={`跳转到 ${getRouteUrl(app.routePath)}`}>路由跳转</span>}
          </div>
        </div>
      </div>
    );
  }
);

AppCard.displayName = 'AppCard';

interface SortableAppCardProps {
  app: Application;
  routes: RouteRule[];
  getRouteUrl: (path: string) => string;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableAppCard(props: SortableAppCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.app.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const dragHandle = (
    <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
      <span>⠿</span>
    </div>
  );

  return (
    <AppCard
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'is-dragging' : ''}
      {...props}
      dragHandle={dragHandle}
    />
  );
}
