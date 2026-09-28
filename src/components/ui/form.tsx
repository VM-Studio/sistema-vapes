"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import {
  Controller,
  FormProvider,
  get,
  set,
  useForm,
  useFormContext,
  type FieldErrors,
  type FieldValues,
  type Path,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

import type { ActionError } from "@/lib/action-result";
import { cn } from "@/lib/utils";

import { Checkbox, type CheckboxProps } from "./checkbox";
import { Input, type InputProps } from "./input";
import { Select, type SelectProps } from "./select";
import { Switch, type SwitchProps } from "./switch";
import { Textarea, type TextareaProps } from "./textarea";

/**
 * useForm + zodResolver con los schemas de src/lib/validations/.
 * Tipado con input (lo que tiene el form) y output (lo que recibe onSubmit,
 * ya transformado: trim, lowercase, coerce...). El servidor vuelve a validar
 * con el MISMO schema: el cliente es solo para feedback rápido.
 */
export function useZodForm<TIn extends FieldValues, TOut extends FieldValues>(
  schema: z.ZodType<TOut, TIn>,
  props?: Omit<UseFormProps<TIn, unknown, TOut>, "resolver"> & {
    /**
     * Errores extra que tienen que sobrevivir a cada validación (ej: "este
     * código ya existe en la DB", verificado en vivo). Si el resolver de Zod
     * pasa pero hay errores extra, el form queda inválido con esos errores.
     */
    erroresExtra?: (valores: TIn) => Record<string, string>;
  },
): UseFormReturn<TIn, unknown, TOut> {
  const { erroresExtra, ...resto } = props ?? {};
  const base = zodResolver(schema);
  return useForm<TIn, unknown, TOut>({
    mode: "onTouched",
    ...resto,
    resolver: async (valores, contexto, opciones) => {
      const resultado = await base(valores, contexto, opciones);
      const extra = erroresExtra?.(valores) ?? {};
      if (Object.keys(extra).length === 0) return resultado;
      const errores = { ...resultado.errors } as FieldErrors<TIn>;
      for (const [campo, message] of Object.entries(extra)) {
        if (!get(errores, campo)) set(errores, campo, { type: "server", message });
      }
      return { values: {}, errors: errores };
    },
  });
}

/**
 * Vuelca un error de Server Action en el form: cada `fields[campo]` va a su
 * input; si no corresponde a ningún campo, queda como error general (root).
 */
export function aplicarErroresServidor<T extends FieldValues, TOut>(
  form: UseFormReturn<T, unknown, TOut>,
  error: ActionError,
): void {
  const campos = Object.entries(error.fields ?? {});
  let asignados = 0;
  for (const [campo, mensajes] of campos) {
    if (campo === "_form" || !mensajes[0]) continue;
    form.setError(
      campo as Path<T>,
      { type: "server", message: mensajes[0] },
      { shouldFocus: asignados === 0 },
    );
    asignados++;
  }
  if (asignados === 0) form.setError("root", { type: "server", message: error.message });
}

export interface FormProps<TIn extends FieldValues, TOut> {
  form: UseFormReturn<TIn, unknown, TOut>;
  onSubmit: SubmitHandler<TOut>;
  children: ReactNode;
  className?: string;
  id?: string;
}

/** <form> con FormProvider, noValidate (valida Zod) y error general arriba. */
export function Form<TIn extends FieldValues, TOut>({
  form,
  onSubmit,
  children,
  className,
  id,
}: FormProps<TIn, TOut>) {
  const errorGeneral = form.formState.errors.root?.message;
  return (
    <FormProvider {...form}>
      <form
        id={id}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("flex flex-col gap-5", className)}
      >
        {errorGeneral && (
          <div
            role="alert"
            className="bg-danger-soft text-danger-soft-foreground border-danger/20 rounded-xl border px-4 py-3 text-sm"
          >
            {errorGeneral}
          </div>
        )}
        {children}
      </form>
    </FormProvider>
  );
}

function useErrorDe(name: string): string | undefined {
  const { formState } = useFormContext();
  return (get(formState.errors, name) as { message?: string } | undefined)?.message;
}

type ConNombre<P> = Omit<P, "name" | "error" | "ref"> & { name: string };

export function FormInput({ name, ...props }: ConNombre<InputProps>) {
  const { register } = useFormContext();
  return <Input {...register(name)} {...props} error={useErrorDe(name)} />;
}

export function FormSelect({ name, ...props }: ConNombre<SelectProps>) {
  const { register } = useFormContext();
  return <Select {...register(name)} {...props} error={useErrorDe(name)} />;
}

export function FormTextarea({ name, ...props }: ConNombre<TextareaProps>) {
  const { register } = useFormContext();
  return <Textarea {...register(name)} {...props} error={useErrorDe(name)} />;
}

export function FormCheckbox({ name, ...props }: ConNombre<CheckboxProps>) {
  const { register } = useFormContext();
  return <Checkbox {...register(name)} {...props} error={useErrorDe(name)} />;
}

export function FormSwitch({
  name,
  ...props
}: Omit<SwitchProps, "checked" | "onCheckedChange" | "error"> & { name: string }) {
  const { control } = useFormContext();
  const error = useErrorDe(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Switch
          {...props}
          checked={Boolean(field.value)}
          onCheckedChange={field.onChange}
          error={error}
        />
      )}
    />
  );
}
