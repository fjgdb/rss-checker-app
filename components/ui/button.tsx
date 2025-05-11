type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "outline" | "default";
};

export function Button({ children, variant = "default", className = "", ...props }: ButtonProps) {
  const base = "px-4 py-2 rounded disabled:opacity-50";
  const style =
    variant === "outline"
      ? "border border-black text-black bg-white hover:bg-gray-100"
      : "bg-black text-white hover:bg-gray-800";

  return (
    <button {...props} className={`${base} ${style} ${className}`}>
      {children}
    </button>
  );
}
