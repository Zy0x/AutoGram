interface InputGroupProps {
  label: string;
  type?: 'text' | 'number';
  placeholder?: string;
  defaultValue?: string | number;
}

export function InputGroup({ label, type = 'text', placeholder, defaultValue }: InputGroupProps) {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <input type={type} className="input-field" placeholder={placeholder} defaultValue={defaultValue} />
    </div>
  );
}

interface SelectGroupProps {
  label: string;
  options: string[];
  defaultValue?: string;
}

export function SelectGroup({ label, options, defaultValue }: SelectGroupProps) {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <select className="input-field" defaultValue={defaultValue}>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
