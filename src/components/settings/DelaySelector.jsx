export function DelaySelector({ name, className, value, options, onChange }) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))

  return (
    <div className={`delay-options ${className}`} role="radiogroup" style={{ '--selected-index': selectedIndex }}>
      <span className="delay-selection" aria-hidden="true" />
      {options.map((option) => (
        <label key={option.value}>
          <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
