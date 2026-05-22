import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

type SelectSurface = "card" | "background";
type NativeOptionElement = React.ReactElement<React.ComponentPropsWithoutRef<"option">, "option">;

const EMPTY_OPTION_VALUE = "__LEX_VAULT_EMPTY_OPTION__";

const SURFACE_CLASS_NAMES: Record<SelectSurface, string> = {
  card: "ui-select-surface-card",
  background: "ui-select-surface-background",
};

type ParsedOption = {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
};

/**
 * 日历等场景复用的自定义下拉框属性。
 */
export interface SelectProps {
  "aria-describedby"?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children: React.ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  surface?: SelectSurface;
  value?: string;
  wrapperClassName?: string;
}

function parseOptions(children: React.ReactNode) {
  const options: ParsedOption[] = [];
  let emptyOptionLabel: React.ReactNode | undefined;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") {
      return;
    }

    const option = child as NativeOptionElement;
    const rawValue = option.props.value ?? option.props.children ?? "";
    const value = String(rawValue);
    const parsedOption: ParsedOption = {
      value,
      label: option.props.children,
      disabled: Boolean(option.props.disabled),
    };

    options.push(parsedOption);
    if (value === "" && emptyOptionLabel === undefined) {
      emptyOptionLabel = parsedOption.label;
    }
  });

  return { options, emptyOptionLabel };
}

function toInternalValue(value?: string) {
  if (value === undefined) {
    return undefined;
  }
  return value === "" ? EMPTY_OPTION_VALUE : value;
}

function toExternalValue(value: string) {
  return value === EMPTY_OPTION_VALUE ? "" : value;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({
    "aria-describedby": ariaDescribedBy,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    className,
    surface = "card",
    wrapperClassName,
    children,
    value,
    defaultValue,
    disabled,
    id,
    name,
    required,
    onChange,
  }, ref) => {
    const { options, emptyOptionLabel } = React.useMemo(() => parseOptions(children), [children]);
    const isControlled = value !== undefined;
    const [uncontrolledValue, setUncontrolledValue] = React.useState<string | undefined>(() => toInternalValue(defaultValue));

    const currentValue = isControlled ? toInternalValue(value) : uncontrolledValue;

    function handleValueChange(nextValue: string) {
      const externalValue = toExternalValue(nextValue);
      if (!isControlled) {
        setUncontrolledValue(nextValue);
      }
      onChange?.({
        target: { value: externalValue, name } as EventTarget & HTMLSelectElement,
        currentTarget: { value: externalValue, name } as EventTarget & HTMLSelectElement,
      } as React.ChangeEvent<HTMLSelectElement>);
    }

    return (
      <div className={cn("ui-select-shell", wrapperClassName)}>
        <SelectPrimitive.Root
          disabled={disabled}
          name={name}
          onValueChange={handleValueChange}
          required={required}
          value={currentValue}
        >
          <SelectPrimitive.Trigger
            aria-describedby={ariaDescribedBy}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={cn(
              "ui-select h-10 w-full rounded-xl text-sm",
              "data-[placeholder]:text-[color:var(--color-muted-foreground)]",
              SURFACE_CLASS_NAMES[surface],
              className,
            )}
            id={id}
            ref={ref}
          >
            <SelectPrimitive.Value placeholder={emptyOptionLabel} />
            <SelectPrimitive.Icon asChild>
              <span aria-hidden="true" className="ui-select-chevron">
                <ChevronDown className="size-4" />
              </span>
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              className="ui-select-content"
              position="popper"
              side="bottom"
              sideOffset={8}
            >
              <SelectPrimitive.ScrollUpButton className="ui-select-scroll-button">
                <ChevronUp className="size-4" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className="ui-select-viewport">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    className="ui-select-item"
                    disabled={option.disabled}
                    key={`${option.value || "__empty__"}-${String(option.label)}`}
                    value={toInternalValue(option.value) ?? EMPTY_OPTION_VALUE}
                  >
                    <span className="ui-select-item-indicator">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="size-4" />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className="ui-select-scroll-button">
                <ChevronDown className="size-4" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
