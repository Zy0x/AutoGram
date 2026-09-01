import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Search, Copy, Check, Braces, FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  jsonString: string;
  fileName: string;
}

export const JsonTreeViewer: React.FC<Props> = ({ jsonString, fileName: _fileName }) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandAll, setExpandAll] = useState(true);

  const parsedData = useMemo(() => {
    try {
      return { data: JSON.parse(jsonString), error: null };
    } catch (e: any) {
      return { data: null, error: e?.message || 'Invalid JSON syntax' };
    }
  }, [jsonString]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
    <div className="td-json-tree-wrap">
      <div className="td-json-tree-toolbar">
        <div className="td-json-toolbar-left">
          <FolderTree size={16} className="text-emerald-400" />
          <span className="td-json-title font-semibold">
            {t('drive.json_tree_title')}
          </span>
        </div>

        <div className="td-json-toolbar-right">
          <div className="td-json-search-box">
            <Search size={13} className="text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('drive.search_tree_placeholder')}
              className="td-json-search-input"
            />
          </div>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={() => setExpandAll((prev) => !prev)}
          >
            <span>{expandAll ? t('drive.collapse_all') : t('drive.expand_all')}</span>
          </button>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied') : t('drive.copy_json')}</span>
          </button>
        </div>
      </div>

      <div className="td-json-tree-body font-mono">
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
