'use client';

import React, { useCallback, useId, useMemo, useRef, useState } from 'react';

import type { DropResult, SensorAPI } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { motion } from 'framer-motion';
import { GripVerticalIcon, Plus, Trash } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useFieldArray, useForm } from 'react-hook-form';
import { prop, sortBy } from 'remeda';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { ZRecipientAuthOptionsSchema } from '@documenso/lib/types/document-auth';
import { nanoid } from '@documenso/lib/universal/id';
import { canRecipientBeModified as utilCanRecipientBeModified } from '@documenso/lib/utils/recipients';
import type { Field, Recipient } from '@documenso/prisma/client';
import { DocumentSigningOrder, RecipientRole, SendStatus } from '@documenso/prisma/client';
import { AnimateGenericFadeInOut } from '@documenso/ui/components/animate/animate-generic-fade-in-out';
import { RecipientActionAuthSelect } from '@documenso/ui/components/recipient/recipient-action-auth-select';
import { RecipientRoleSelect } from '@documenso/ui/components/recipient/recipient-role-select';
import { cn } from '@documenso/ui/lib/utils';

import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../form/form';
import { FormErrorMessage } from '../form/form-error-message';
import { Input } from '../input';
import { useStep } from '../stepper';
import { useToast } from '../use-toast';
import type { TAddSignersFormSchema } from './add-signers.types';
import { ZAddSignersFormSchema } from './add-signers.types';
import {
  DocumentFlowFormContainerActions,
  DocumentFlowFormContainerContent,
  DocumentFlowFormContainerFooter,
  DocumentFlowFormContainerHeader,
  DocumentFlowFormContainerStep,
} from './document-flow-root';
import { ShowFieldItem } from './show-field-item';
import type { DocumentFlowStep } from './types';

export type AddSignersFormProps = {
  documentFlow: DocumentFlowStep;
  recipients: Recipient[];
  fields: Field[];
  signingOrder?: DocumentSigningOrder | null;
  isDocumentEnterprise: boolean;
  onSubmit: (_data: TAddSignersFormSchema) => void;
  isDocumentPdfLoaded: boolean;
};

export const AddSignersFormPartial = ({
  documentFlow,
  recipients,
  fields,
  signingOrder,
  isDocumentEnterprise,
  onSubmit,
  isDocumentPdfLoaded,
}: AddSignersFormProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { remaining } = useLimits();
  const { data: session } = useSession();

  const user = session?.user;

  const initialId = useId();
  const $sensorApi = useRef<SensorAPI | null>(null);

  const { currentStep, totalSteps, previousStep } = useStep();

  const defaultRecipients = [
    {
      formId: initialId,
      name: '',
      email: '',
      role: RecipientRole.SIGNER,
      signingOrder: 1,
      actionAuth: undefined,
    },
  ];

  const form = useForm<TAddSignersFormSchema>({
    resolver: zodResolver(ZAddSignersFormSchema),
    defaultValues: {
      signers:
        recipients.length > 0
          ? sortBy(
              recipients.map((recipient, index) => ({
                nativeId: recipient.id,
                formId: String(recipient.id),
                name: recipient.name,
                email: recipient.email,
                role: recipient.role,
                signingOrder: recipient.signingOrder ?? index + 1,
                actionAuth:
                  ZRecipientAuthOptionsSchema.parse(recipient.authOptions)?.actionAuth ?? undefined,
              })),
              [prop('signingOrder'), 'asc'],
              [prop('nativeId'), 'asc'],
            )
          : defaultRecipients,
      signingOrder: signingOrder || DocumentSigningOrder.PARALLEL,
    },
  });

  // Always show advanced settings if any recipient has auth options.
  const alwaysShowAdvancedSettings = useMemo(() => {
    const recipientHasAuthOptions = recipients.find((recipient) => {
      const recipientAuthOptions = ZRecipientAuthOptionsSchema.parse(recipient.authOptions);

      return recipientAuthOptions?.accessAuth || recipientAuthOptions?.actionAuth;
    });

    const formHasActionAuth = form.getValues('signers').find((signer) => signer.actionAuth);

    return recipientHasAuthOptions !== undefined || formHasActionAuth !== undefined;
  }, [recipients, form]);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(alwaysShowAdvancedSettings);

  const {
    setValue,
    formState: { errors, isSubmitting },
    control,
    watch,
  } = form;

  const watchedSigners = watch('signers');
  const isSigningOrderSequential = watch('signingOrder') === DocumentSigningOrder.SEQUENTIAL;

  const normalizeSigningOrders = (signers: typeof watchedSigners) => {
    return signers
      .sort((a, b) => (a.signingOrder ?? 0) - (b.signingOrder ?? 0))
      .map((signer, index) => ({ ...signer, signingOrder: index + 1 }));
  };

  const onFormSubmit = form.handleSubmit(onSubmit);

  const {
    append: appendSigner,
    fields: signers,
    remove: removeSigner,
  } = useFieldArray({
    control,
    name: 'signers',
  });

  const emptySignerIndex = watchedSigners.findIndex((signer) => !signer.name && !signer.email);
  const isUserAlreadyARecipient = watchedSigners.some(
    (signer) => signer.email.toLowerCase() === user?.email?.toLowerCase(),
  );

  const hasDocumentBeenSent = recipients.some(
    (recipient) => recipient.sendStatus === SendStatus.SENT,
  );

  const canRecipientBeModified = (recipientId?: number) => {
    if (recipientId === undefined) {
      return true;
    }

    const recipient = recipients.find((recipient) => recipient.id === recipientId);

    if (!recipient) {
      return false;
    }

    return utilCanRecipientBeModified(recipient, fields);
  };

  const onAddSigner = () => {
    appendSigner({
      formId: nanoid(12),
      name: '',
      email: '',
      role: RecipientRole.SIGNER,
      actionAuth: undefined,
      signingOrder: signers.length > 0 ? (signers[signers.length - 1]?.signingOrder ?? 0) + 1 : 1,
    });
  };

  const onRemoveSigner = (index: number) => {
    const signer = signers[index];

    if (!canRecipientBeModified(signer.nativeId)) {
      toast({
        title: _(msg`Cannot remove signer`),
        description: _(msg`This signer has already signed the document.`),
        variant: 'destructive',
      });

      return;
    }

    removeSigner(index);

    const updatedSigners = signers.filter((_, idx) => idx !== index);
    form.setValue('signers', normalizeSigningOrders(updatedSigners));
  };

  const onAddSelfSigner = () => {
    if (emptySignerIndex !== -1) {
      setValue(`signers.${emptySignerIndex}.name`, user?.name ?? '');
      setValue(`signers.${emptySignerIndex}.email`, user?.email ?? '');
    } else {
      appendSigner({
        formId: nanoid(12),
        name: user?.name ?? '',
        email: user?.email ?? '',
        role: RecipientRole.SIGNER,
        actionAuth: undefined,
        signingOrder: signers.length > 0 ? (signers[signers.length - 1]?.signingOrder ?? 0) + 1 : 1,
      });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      onAddSigner();
    }
  };

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!result.destination) return;

      const items = Array.from(watchedSigners);
      const [reorderedSigner] = items.splice(result.source.index, 1);

      let insertIndex = result.destination.index;
      while (insertIndex < items.length && !canRecipientBeModified(items[insertIndex].nativeId)) {
        insertIndex++;
      }

      items.splice(insertIndex, 0, reorderedSigner);

      const updatedSigners = items.map((item, index) => ({
        ...item,
        signingOrder: !canRecipientBeModified(item.nativeId) ? item.signingOrder : index + 1,
      }));

      updatedSigners.forEach((item, index) => {
        const keys: (keyof typeof item)[] = [
          'formId',
          'nativeId',
          'email',
          'name',
          'role',
          'signingOrder',
          'actionAuth',
        ];
        keys.forEach((key) => {
          form.setValue(`signers.${index}.${key}` as const, item[key]);
        });
      });

      const currentLength = form.getValues('signers').length;
      if (currentLength > updatedSigners.length) {
        for (let i = updatedSigners.length; i < currentLength; i++) {
          form.unregister(`signers.${i}`);
        }
      }

      await form.trigger('signers');
    },
    [form, canRecipientBeModified, watchedSigners],
  );

  const triggerDragAndDrop = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!$sensorApi.current) {
        return;
      }

      const draggableId = signers[fromIndex].id;

      const preDrag = $sensorApi.current.tryGetLock(draggableId);

      if (!preDrag) {
        return;
      }

      const drag = preDrag.snapLift();

      setTimeout(() => {
        // Move directly to the target index
        if (fromIndex < toIndex) {
          for (let i = fromIndex; i < toIndex; i++) {
            drag.moveDown();
          }
        } else {
          for (let i = fromIndex; i > toIndex; i--) {
            drag.moveUp();
          }
        }

        setTimeout(() => {
          drag.drop();
        }, 500);
      }, 0);
    },
    [signers],
  );

  const updateSigningOrders = useCallback(
    (newIndex: number, oldIndex: number) => {
      const updatedSigners = form.getValues('signers').map((signer, index) => {
        if (index === oldIndex) {
          return { ...signer, signingOrder: newIndex + 1 };
        } else if (index >= newIndex && index < oldIndex) {
          return {
            ...signer,
            signingOrder: !canRecipientBeModified(signer.nativeId)
              ? signer.signingOrder
              : (signer.signingOrder ?? index + 1) + 1,
          };
        } else if (index <= newIndex && index > oldIndex) {
          return {
            ...signer,
            signingOrder: !canRecipientBeModified(signer.nativeId)
              ? signer.signingOrder
              : Math.max(1, (signer.signingOrder ?? index + 1) - 1),
          };
        }
        return signer;
      });

      updatedSigners.forEach((signer, index) => {
        form.setValue(`signers.${index}.signingOrder`, signer.signingOrder);
      });
    },
    [form, canRecipientBeModified],
  );

  const handleSigningOrderChange = useCallback(
    (index: number, newOrderString: string) => {
      const newOrder = parseInt(newOrderString, 10);

      if (!newOrderString.trim()) {
        return;
      }

      if (Number.isNaN(newOrder)) {
        form.setValue(`signers.${index}.signingOrder`, index + 1);
        return;
      }

      const newIndex = newOrder - 1;
      if (index !== newIndex) {
        updateSigningOrders(newIndex, index);
        triggerDragAndDrop(index, newIndex);
      }
    },
    [form, triggerDragAndDrop, updateSigningOrders],
  );

  return (
    <>
      <DocumentFlowFormContainerHeader
        title={documentFlow.title}
        description={documentFlow.description}
      />
      <DocumentFlowFormContainerContent>
        {isDocumentPdfLoaded &&
          fields.map((field, index) => (
            <ShowFieldItem key={index} field={field} recipients={recipients} />
          ))}

        <AnimateGenericFadeInOut motionKey={showAdvancedSettings ? 'Show' : 'Hide'}>
          <Form {...form}>
            <FormField
              control={form.control}
              name="signingOrder"
              render={({ field }) => (
                <FormItem className="mb-6 flex flex-row items-center space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      {...field}
                      id="signingOrder"
                      checkClassName="text-white"
                      checked={field.value === DocumentSigningOrder.SEQUENTIAL}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked ? DocumentSigningOrder.SEQUENTIAL : DocumentSigningOrder.PARALLEL,
                        )
                      }
                      disabled={isSubmitting || hasDocumentBeenSent}
                    />
                  </FormControl>

                  <FormLabel
                    htmlFor="signingOrder"
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    <Trans>Enable signing order</Trans>
                  </FormLabel>
                </FormItem>
              )}
            />
            <DragDropContext
              onDragEnd={onDragEnd}
              sensors={[
                (api: SensorAPI) => {
                  $sensorApi.current = api;
                },
              ]}
            >
              <Droppable droppableId="signers">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="flex w-full flex-col gap-y-2"
                  >
                    {signers.map((signer, index) => (
                      <Draggable
                        key={`${signer.id}-${signer.signingOrder}`}
                        draggableId={signer.id}
                        index={index}
                        isDragDisabled={
                          !isSigningOrderSequential ||
                          isSubmitting ||
                          !canRecipientBeModified(signer.nativeId) ||
                          !signer.signingOrder
                        }
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={cn('py-1', {
                              'bg-widget-foreground pointer-events-none rounded-md pt-2':
                                snapshot.isDragging,
                            })}
                          >
                            <motion.fieldset
                              data-native-id={signer.nativeId}
                              disabled={isSubmitting || !canRecipientBeModified(signer.nativeId)}
                              className={cn('grid grid-cols-10 items-end gap-2 pb-2', {
                                'border-b pt-2': showAdvancedSettings,
                                'grid-cols-12 pr-3': isSigningOrderSequential,
                              })}
                            >
                              {isSigningOrderSequential && (
                                <FormField
                                  control={form.control}
                                  name={`signers.${index}.signingOrder`}
                                  render={({ field }) => (
                                    <FormItem className="col-span-2 mt-auto flex items-center gap-x-1 space-y-0">
                                      <GripVerticalIcon className="h-5 w-5 flex-shrink-0 opacity-40" />
                                      <FormControl>
                                        <Input
                                          type="number"
                                          max={signers.length}
                                          className={cn(
                                            'w-full text-center',
                                            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                                          )}
                                          {...field}
                                          onChange={(e) => {
                                            field.onChange(e);
                                            handleSigningOrderChange(index, e.target.value);
                                          }}
                                          onBlur={(e) => {
                                            field.onBlur();
                                            handleSigningOrderChange(index, e.target.value);
                                          }}
                                          disabled={
                                            snapshot.isDragging ||
                                            isSubmitting ||
                                            !canRecipientBeModified(signer.nativeId)
                                          }
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              )}

                              <FormField
                                control={form.control}
                                name={`signers.${index}.email`}
                                render={({ field }) => (
                                  <FormItem
                                    className={cn('relative', {
                                      'col-span-4': !showAdvancedSettings,
                                      'col-span-5': showAdvancedSettings,
                                    })}
                                  >
                                    {!showAdvancedSettings && (
                                      <FormLabel required>
                                        <Trans>Email</Trans>
                                      </FormLabel>
                                    )}

                                    <FormControl>
                                      <Input
                                        type="email"
                                        placeholder={_(msg`Email`)}
                                        {...field}
                                        disabled={
                                          snapshot.isDragging ||
                                          isSubmitting ||
                                          !canRecipientBeModified(signer.nativeId)
                                        }
                                        onKeyDown={onKeyDown}
                                      />
                                    </FormControl>

                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name={`signers.${index}.name`}
                                render={({ field }) => (
                                  <FormItem
                                    className={cn({
                                      'col-span-4': !showAdvancedSettings,
                                      'col-span-5': showAdvancedSettings,
                                    })}
                                  >
                                    {!showAdvancedSettings && (
                                      <FormLabel>
                                        <Trans>Name</Trans>
                                      </FormLabel>
                                    )}

                                    <FormControl>
                                      <Input
                                        placeholder={_(msg`Name`)}
                                        {...field}
                                        disabled={
                                          snapshot.isDragging ||
                                          isSubmitting ||
                                          !canRecipientBeModified(signer.nativeId)
                                        }
                                        onKeyDown={onKeyDown}
                                      />
                                    </FormControl>

                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              {showAdvancedSettings && isDocumentEnterprise && (
                                <FormField
                                  control={form.control}
                                  name={`signers.${index}.actionAuth`}
                                  render={({ field }) => (
                                    <FormItem
                                      className={cn('col-span-8', {
                                        'col-span-10': isSigningOrderSequential,
                                      })}
                                    >
                                      <FormControl>
                                        <RecipientActionAuthSelect
                                          {...field}
                                          onValueChange={field.onChange}
                                          disabled={
                                            snapshot.isDragging ||
                                            isSubmitting ||
                                            !canRecipientBeModified(signer.nativeId)
                                          }
                                        />
                                      </FormControl>

                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              )}

                              <div className="col-span-2 flex gap-x-2">
                                <FormField
                                  name={`signers.${index}.role`}
                                  render={({ field }) => (
                                    <FormItem className="mt-auto">
                                      <FormControl>
                                        <RecipientRoleSelect
                                          {...field}
                                          onValueChange={field.onChange}
                                          disabled={
                                            snapshot.isDragging ||
                                            isSubmitting ||
                                            !canRecipientBeModified(signer.nativeId)
                                          }
                                        />
                                      </FormControl>

                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <button
                                  type="button"
                                  className="mt-auto inline-flex h-10 w-10 items-center justify-center hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={
                                    snapshot.isDragging ||
                                    isSubmitting ||
                                    !canRecipientBeModified(signer.nativeId) ||
                                    signers.length === 1
                                  }
                                  onClick={() => onRemoveSigner(index)}
                                >
                                  <Trash className="h-4 w-4" />
                                </button>
                              </div>
                            </motion.fieldset>
                          </div>
                        )}
                      </Draggable>
                    ))}

                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            <FormErrorMessage
              className="mt-2"
              // Dirty hack to handle errors when .root is populated for an array type
              error={'signers__root' in errors && errors['signers__root']}
            />

            <div
              className={cn('mt-2 flex flex-row items-center space-x-4', {
                'mt-4': showAdvancedSettings,
              })}
            >
              <Button
                type="button"
                className="flex-1"
                disabled={isSubmitting || signers.length >= remaining.recipients}
                onClick={() => onAddSigner()}
              >
                <Plus className="-ml-1 mr-2 h-5 w-5" />
                <Trans>Add Signer</Trans>
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="dark:bg-muted dark:hover:bg-muted/80 bg-black/5 hover:bg-black/10"
                disabled={isSubmitting || isUserAlreadyARecipient}
                onClick={() => onAddSelfSigner()}
              >
                <Plus className="-ml-1 mr-2 h-5 w-5" />
                <Trans>Add myself</Trans>
              </Button>
            </div>

            {!alwaysShowAdvancedSettings && isDocumentEnterprise && (
              <div className="mt-4 flex flex-row items-center">
                <Checkbox
                  id="showAdvancedRecipientSettings"
                  className="h-5 w-5"
                  checkClassName="dark:text-white text-primary"
                  checked={showAdvancedSettings}
                  onCheckedChange={(value) => setShowAdvancedSettings(Boolean(value))}
                />

                <label
                  className="text-muted-foreground ml-2 text-sm"
                  htmlFor="showAdvancedRecipientSettings"
                >
                  <Trans>Show advanced settings</Trans>
                </label>
              </div>
            )}
          </Form>
        </AnimateGenericFadeInOut>
      </DocumentFlowFormContainerContent>

      <DocumentFlowFormContainerFooter>
        <DocumentFlowFormContainerStep step={currentStep} maxStep={totalSteps} />

        <DocumentFlowFormContainerActions
          loading={isSubmitting}
          disabled={isSubmitting}
          onGoBackClick={previousStep}
          onGoNextClick={() => void onFormSubmit()}
        />
      </DocumentFlowFormContainerFooter>
    </>
  );
};
