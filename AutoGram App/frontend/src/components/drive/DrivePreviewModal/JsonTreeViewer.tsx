import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Search, Braces } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  jsonString: string;
  fileName: string;
  expandAll?: boolean;
  searchOpen?: boolean;
  onToggleSearch?: () => void;
}

export const JsonTreeViewer: React.FC<Props> = ({
  jsonString,
  fileName: _fileName,
  expandAll: controlledExpandAll,
  searchOpen: controlledSearchOpen,
  onToggleSearch,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [internalExpandAll] = useState(true);
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);

  const expandAll = controlledExpandAll !== undefined ? controlledExpandAll : internalExpandAll;
  const isSearchOpen = controlledSearchOpen !== undefined ? controlledSearchOpen : internalSearchOpen;
  const toggleSearch = onToggleSearch || (() => setInternalSearchOpen((prev) => !prev));

  const parsedData = useMemo(() => {
    try {
      return { data: JSON.parse(jsonString), error: null };
    } catch (e: any) {
      return { data: null, error: e?.message || 'Invalid JSON syntax' };
    }
  }, [jsonString]);

  if (parsedData.error) {
    return (
      <div className="td-json-error-card">
        <Braces size={24} className="text-amber-400" />
        <div className="td-json-error-title">
          {t('drive.json_parse_error')}
        </div>
        <p className="td-json-error-desc">{parsedData.error}</p>
      </div>
    );
  }

  return (
    <div className="td-json-tree-wrap" style={{ position: 'relative' }}>
      {/* Floating Compact Search Popup */}
      {isSearchOpen && (
        <div
          className="td-json-search-box is-floating"
          style={{
            position: 'absolute',
            top: '8px',
            right: '16px',
            zIndex: 10,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '8px',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <Search size={13} className="text-sky-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('drive.search_tree_placeholder')}
            className="td-json-search-input"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: '12px',
              width: '160px',
            }}
            autoFocus
          />
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={toggleSearch}
            style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '4px' }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="td-json-tree-body font-mono" style={{ padding: '16px 20px', height: '100%', overflowY: 'auto' }}>
        <JsonNode
          data={parsedData.data}
          name="root"
          isRoot
          searchQuery={searchQuery.toLowerCase()}
          defaultExpanded={expandAll}
        />
      </div>
    </div>
  );
};

interface NodeProps {
  data: any;
  name: string;
  isRoot?: boolean;
  searchQuery: string;
  defaultExpanded: boolean;
}

const JsonNode: React.FC<NodeProps> = ({
  data,
  name,
  isRoot = false,
  searchQuery,
  defaultExpanded,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isObject = data !== null && typeof data === 'object';
  const isArray = Array.isArray(data);

  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    if (name.toLowerCase().includes(searchQuery)) return true;
    if (!isObject && String(data).toLowerCase().includes(searchQuery)) return true;
    return false;
  }, [name, data, isObject, searchQuery]);

  if (!matchesSearch && searchQuery) return null;

  if (isObject) {
    const keys = Object.keys(data);
    const count = keys.length;

    return (
      <div className="td-json-node">
        <div
          className="td-json-node-row is-collapsible"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="td-json-toggle">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          {!isRoot && <span className="td-json-key">{name}: </span>}
          <span className="td-json-type-badge">
            {isArray ? `Array[${count}]` : `Object{${count}}`}
          </span>
        </div>

        {expanded && (
          <div className="td-json-children">
            {keys.map((k) => (
              <JsonNode
                key={k}
                data={data[k]}
                name={k}
                searchQuery={searchQuery}
                defaultExpanded={defaultExpanded}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Primitive value
  let typeClass = 'td-json-str';
  if (typeof data === 'number') typeClass = 'td-json-num';
  else if (typeof data === 'boolean') typeClass = 'td-json-bool';
  else if (data === null) typeClass = 'td-json-null';

  return (
    <div className="td-json-node-leaf">
      <span className="td-json-indent-space" />
      <span className="td-json-key">{name}: </span>
      <span className={`td-json-val ${typeClass}`}>
        {typeof data === 'string' ? `"${data}"` : String(data)}
      </span>
    </div>
  );
};
