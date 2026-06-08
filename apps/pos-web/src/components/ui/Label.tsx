import { forwardRef } from 'react';
import { cn } from './Button';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {} // eslint-disable-line @typescript-eslint/no-empty-object-type

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-slate-700",
          className
        )}
        {...props}
      />
    );
  }
);
Label.displayName = "Label";
