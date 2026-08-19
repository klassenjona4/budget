type SwitchProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function Switch({ label, description, checked, onChange }: SwitchProps) {
  return (
    <div className="stack stack--tight">
      <div className="switch-row">
        <span>{label}</span>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
        />
      </div>
      {description ? <p className="faint">{description}</p> : null}
    </div>
  );
}
