"use client";

import Image from "next/image";
import PhotoAnalysis from "./photo-analysis";
import { photoInputAccept, validatePhotoMetadata } from "@/lib/photo-validation";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type VehicleForm = {
  customerName: string;
  model: string;
  year: string;
  vin: string;
  side: string;
};

type FormErrors = Partial<Record<keyof VehicleForm | "photo" | "consent", string>>;

type SavedRequest = {
  requestId: string;
  vehicle: VehicleForm;
  photoName: string;
  createdAt: string;
  status: string;
};

type SubmissionResponse = {
  request?: {
    id: string;
    status: string;
    createdAt: string;
  };
  error?: string;
};

const initialForm: VehicleForm = {
  customerName: "",
  model: "",
  year: "",
  vin: "",
  side: "",
};

const supportedYears = Array.from({ length: 8 }, (_, index) => String(2014 - index));
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const previewablePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

const headlightSides = [
  { value: "Left (driver side)", label: "Left", description: "Driver side" },
  { value: "Right (passenger side)", label: "Right", description: "Passenger side" },
  { value: "Not sure", label: "Not sure", description: "Seller will confirm" },
] as const;

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="2">
      <path d="m5 10.5 3.1 3L15 6.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 fill-none stroke-current" strokeWidth="1.8">
      <path d="M12 16V5m0 0L8 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14.5v3.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14.5" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7">
      <rect x="4.5" y="8.2" width="11" height="8" rx="2" />
      <path d="M7 8.2V6.5a3 3 0 0 1 6 0v1.7" />
    </svg>
  );
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VehicleDetailsForm() {
  const [form, setForm] = useState<VehicleForm>(initialForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [savedRequest, setSavedRequest] = useState<SavedRequest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consent, setConsent] = useState(false);
  const submissionLock = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (savedRequest || submitError) feedbackRef.current?.focus();
  }, [savedRequest, submitError]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function updateField(field: keyof VehicleForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSavedRequest(null);
    setSubmitError(null);
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function handleVinChange(value: string) {
    const normalizedVin = value.toUpperCase().replace(/\s/g, "").slice(0, 17);
    updateField("vin", normalizedVin);
  }

  function selectPhoto(selectedPhoto: File) {
    setPhotoRevision(current => current + 1);
    setSavedRequest(null);
    setSubmitError(null);

    const photoError = validatePhotoMetadata(selectedPhoto);
    if (photoError) {
      setPhoto(null);
      setPhotoPreview(null);
      setErrors((current) => ({
        ...current,
        photo: photoError.error,
      }));
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    setPhoto(selectedPhoto);
    setErrors((current) => ({ ...current, photo: undefined }));
    setPhotoPreview(URL.createObjectURL(selectedPhoto));
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedPhoto = event.target.files?.[0];
    if (selectedPhoto) selectPhoto(selectedPhoto);
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    setSavedRequest(null);
    setSubmitError(null);
    setErrors((current) => ({ ...current, photo: undefined }));
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current || savedRequest) return;

    const nextErrors: FormErrors = {};

    if (form.customerName.trim().length < 2 || form.customerName.trim().length > 150) {
      nextErrors.customerName = "Enter a customer name between 2 and 150 characters.";
    }

    if (!form.model) {
      nextErrors.model = "Select your vehicle model.";
    }

    if (!form.year) {
      nextErrors.year = "Select the vehicle year.";
    }

    if (form.vin && !vinPattern.test(form.vin)) {
      nextErrors.vin = "Enter a valid 17-character VIN without I, O, or Q.";
    }

    if (!form.side) {
      nextErrors.side = "Select the headlight side, or choose Not sure.";
    }

    if (!photo || photo.size === 0) {
      nextErrors.photo = "Choose a clear headlight photo.";
    }

    if (!consent) {
      nextErrors.consent = "Confirm your permission before submitting.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const currentForm = event.currentTarget;
      requestAnimationFrame(() => currentForm.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }

    if (Object.keys(nextErrors).length === 0 && photo) {
      submissionLock.current = true;
      setIsSubmitting(true);
      setSubmitError(null);
      setSessionExpired(false);
      setSavedRequest(null);

      const normalizedVehicle = {
        ...form,
        customerName: form.customerName.trim(),
      };
      const requestData = new FormData();

      requestData.set("customerName", normalizedVehicle.customerName);
      requestData.set("model", normalizedVehicle.model);
      requestData.set("year", normalizedVehicle.year);
      requestData.set("vin", normalizedVehicle.vin);
      requestData.set("side", normalizedVehicle.side);
      requestData.set("photo", photo);
      requestData.set("consent", "true");

      try {
        const response = await fetch("/api/requests", {
          method: "POST",
          body: requestData,
          signal: AbortSignal.timeout(60_000),
        });
        const result = (await response.json().catch(() => null)) as SubmissionResponse | null;
        if (response.status === 401) setSessionExpired(true);

        if (!response.ok || !result?.request?.id || !result.request.createdAt || !result.request.status) {
          throw new Error(result?.error || "We could not confirm submission. Your details are still here. Please try again later.");
        }

        setSavedRequest({
          requestId: result.request.id,
          vehicle: normalizedVehicle,
          photoName: photo.name,
          createdAt: result.request.createdAt,
          status: result.request.status,
        });
      } catch (error) {
        setSubmitError(
          error instanceof Error && error.name === "TimeoutError"
            ? "Submission is taking longer than expected. We could not confirm whether it was saved. Keep these details and try again later."
            : error instanceof TypeError
            ? "We could not connect to the submission service. Check your connection and try again. Your details are still here."
            : error instanceof Error
            ? error.message
            : "The request could not be submitted. Please try again.",
        );
      } finally {
        submissionLock.current = false;
        setIsSubmitting(false);
      }
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dfe3e9] bg-white shadow-[0_8px_30px_rgba(24,32,51,0.055)]">
      <div className="flex flex-col gap-3 border-b border-[#e8eaee] px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-7">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-[#182033]">Request details</h2>
          <p className="mt-1.5 text-sm text-[#737d8d]">Provide the information a seller needs to identify the correct headlight.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-[#707a8b]">
          <span className="size-1.5 rounded-full bg-[#536ee8]" />
          Seller review required
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} className="px-6 py-7 sm:px-8 sm:py-9">
        <fieldset disabled={isSubmitting || Boolean(savedRequest)} className="min-w-0">
        <legend className="sr-only">Customer request details and permission</legend>
        <div className="grid min-w-0 gap-x-5 gap-y-6 sm:grid-cols-2">
          <div className="flex items-end justify-between border-b border-[#eceef1] pb-4 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-[#293142]">Customer and vehicle</h3>
              <p className="mt-1 text-xs text-[#89919e]">Your contact name and vehicle identification.</p>
            </div>
            <span className="text-xs font-medium text-[#9aa1ad]">01</span>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="customer-name" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Customer full name <span className="text-[#d45b5b]">*</span>
            </label>
            <input
              id="customer-name"
              name="customerName"
              type="text"
              maxLength={150}
              value={form.customerName}
              onChange={(event) => updateField("customerName", event.target.value)}
              autoComplete="name"
              placeholder="Enter your full name"
              aria-invalid={Boolean(errors.customerName)}
              aria-describedby={errors.customerName ? "customer-name-error" : "customer-name-help"}
              className={`h-12 w-full rounded-[10px] border bg-white px-3.5 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition placeholder:text-[#a2a9b5] focus:ring-3 ${
                errors.customerName
                  ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                  : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
              }`}
            />
            {errors.customerName ? (
              <p id="customer-name-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.customerName}
              </p>
            ) : (
              <p id="customer-name-help" className="mt-2 text-xs text-[#858e9d]">
                This name will identify your request to the participating seller.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="vehicle-model" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Vehicle model <span className="text-[#d45b5b]">*</span>
            </label>
            <div className="relative">
              <select
                id="vehicle-model"
                name="model"
                value={form.model}
                onChange={(event) => updateField("model", event.target.value)}
                aria-invalid={Boolean(errors.model)}
                aria-describedby={errors.model ? "model-error" : "model-help"}
                className={`h-12 w-full appearance-none rounded-[10px] border bg-white px-3.5 pr-11 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition focus:ring-3 ${
                  errors.model
                    ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                    : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
                }`}
              >
                <option value="" disabled>
                  Select a model
                </option>
                <option value="Mercedes-Benz C-Class (W204)">Mercedes-Benz C-Class (W204)</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[#7d8695]">
                <ChevronDownIcon />
              </span>
            </div>
            {errors.model ? (
              <p id="model-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.model}
              </p>
            ) : (
              <p id="model-help" className="mt-2 text-xs text-[#858e9d]">
                The current pilot supports the Mercedes-Benz C-Class W204.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="vehicle-year" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Year <span className="text-[#d45b5b]">*</span>
            </label>
            <div className="relative">
              <select
                id="vehicle-year"
                name="year"
                value={form.year}
                onChange={(event) => updateField("year", event.target.value)}
                aria-invalid={Boolean(errors.year)}
                aria-describedby={errors.year ? "year-error" : undefined}
                className={`h-12 w-full appearance-none rounded-[10px] border bg-white px-3.5 pr-11 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition focus:ring-3 ${
                  errors.year
                    ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                    : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
                }`}
              >
                <option value="" disabled>
                  Select year
                </option>
                {supportedYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[#7d8695]">
                <ChevronDownIcon />
              </span>
            </div>
            {errors.year ? (
              <p id="year-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.year}
              </p>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="vehicle-vin" className="block text-[13px] font-medium text-[#344054]">
                VIN
              </label>
              <span className="text-xs font-normal text-[#8b93a1]">
                Optional
              </span>
            </div>
            <input
              id="vehicle-vin"
              name="vin"
              type="text"
              value={form.vin}
              onChange={(event) => handleVinChange(event.target.value)}
              maxLength={17}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. WDDGF4HB0CA123456"
              aria-invalid={Boolean(errors.vin)}
              aria-describedby={errors.vin ? "vin-error" : "vin-help"}
              className={`h-12 w-full rounded-[10px] border bg-white px-3.5 font-mono text-sm uppercase tracking-[0.04em] text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[#a2a9b5] focus:ring-3 ${
                errors.vin
                  ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                  : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
              }`}
            />
            {errors.vin ? (
              <p id="vin-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.vin}
              </p>
            ) : (
              <div id="vin-help" className="mt-2 flex items-center justify-between gap-3 text-xs text-[#858e9d]">
                <span>17 characters; I, O and Q are not used.</span>
                <span aria-label={`${form.vin.length} of 17 characters`}>{form.vin.length}/17</span>
              </div>
            )}
          </div>

          <div className="mt-2 flex items-end justify-between border-b border-[#eceef1] pb-4 pt-5 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-[#293142]">Headlight information</h3>
              <p className="mt-1 text-xs text-[#89919e]">Select the damaged side and attach one clear photo.</p>
            </div>
            <span className="text-xs font-medium text-[#9aa1ad]">02</span>
          </div>

          <fieldset className="sm:col-span-2" aria-invalid={Boolean(errors.side)} tabIndex={errors.side ? -1 : undefined} aria-describedby={errors.side ? "side-error" : "side-help"}>
            <legend className="mb-2.5 text-[13px] font-medium text-[#344054]">
              Headlight side <span className="text-[#d45b5b]">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {headlightSides.map((side) => (
                <label
                  key={side.value}
                  className={`relative cursor-pointer rounded-[10px] border px-4 py-3.5 transition ${
                    form.side === side.value
                      ? "border-[#536ee8] bg-[#f5f6ff] shadow-[0_0_0_3px_rgba(83,110,232,0.08)]"
                      : "border-[#cfd5dd] bg-white hover:border-[#aeb7c5] hover:bg-[#fafbfc]"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="side"
                      value={side.value}
                      checked={form.side === side.value}
                      onChange={(event) => updateField("side", event.target.value)}
                      className="size-4 accent-[#536ee8]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[#30394a]">{side.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[#89919e]">{side.description}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {errors.side ? (
              <p id="side-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.side}
              </p>
            ) : (
              <p id="side-help" className="mt-2 text-xs text-[#858e9d]">
                Choose &quot;Not sure&quot; if the photo does not make the side clear.
              </p>
            )}
          </fieldset>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="headlight-photo" className="block text-[13px] font-medium text-[#344054]">
                Headlight photo <span className="text-[#d45b5b]">*</span>
              </label>
              <span className="text-xs text-[#8b93a1]">Maximum 10 MB</span>
            </div>
            <div
              className={`rounded-xl border p-5 ${
                errors.photo
                  ? "border-[#d45b5b] bg-[#fffafa]"
                  : photo
                    ? "border-[#b8d8cd] bg-[#f8fcfa]"
                    : "border-[#d7dce4] bg-[#fafbfc]"
              }`}
            >
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-[#dfe3ea] bg-white text-[#5d6b80] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                      <UploadIcon />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#30394a]">Select a damage photo</p>
                      <p className="mt-1 text-xs leading-5 text-[#858e9d]">
                        JPG, PNG, WebP, HEIC or AVIF up to 10 MB.
                      </p>
                    </div>
                  </div>

                  <input
                    ref={photoInputRef}
                    id="headlight-photo"
                    name="photo"
                    type="file"
                    accept={photoInputAccept}
                    onClick={(event) => {
                      event.currentTarget.value = "";
                    }}
                    onChange={handlePhotoChange}
                    aria-invalid={Boolean(errors.photo)}
                    aria-describedby={errors.photo ? "photo-error" : "photo-help"}
                    className="mt-5 block w-full cursor-pointer rounded-[10px] border border-[#cfd5dd] bg-white text-sm text-[#657083] shadow-[0_1px_2px_rgba(16,24,40,0.03)] file:mr-4 file:cursor-pointer file:border-0 file:border-r file:border-[#dfe3e9] file:bg-[#f3f5f8] file:px-4 file:py-3 file:text-sm file:font-semibold file:text-[#344054] hover:border-[#aeb7c5] focus:outline-none focus:ring-3 focus:ring-[#536ee8]/10"
                  />

                  {photo ? (
                    <div className="mt-4 flex items-start gap-3 rounded-[10px] border border-[#cce3da] bg-white p-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e1f2ec] text-[#28735e]">
                        <CheckIcon />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#31483f]">{photo.name}</p>
                        <p className="mt-0.5 text-xs text-[#73847d]">{formatFileSize(photo.size)} · Image ready</p>
                      </div>
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="shrink-0 text-xs font-semibold text-[#a54b4b] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[#858e9d]">No image selected.</p>
                  )}
                </div>

                <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-[#dfe3e9] bg-[#eef1f4]">
                  {photo && photoPreview && previewablePhotoTypes.has(photo.type) ? (
                    <Image
                      src={photoPreview}
                      alt={`Preview of ${photo.name}`}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 100vw, 240px"
                      className="object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center p-5 text-center text-[#8a94a3]">
                      <div>
                        <span className="mx-auto grid size-10 place-items-center rounded-full bg-white text-[#6e7a8c] shadow-sm">
                          <UploadIcon />
                        </span>
                        <p className="mt-2 text-xs font-medium">
                          {photo ? "Preview is unavailable for this format" : "Image preview"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {errors.photo ? (
              <p id="photo-error" role="alert" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.photo}
              </p>
            ) : (
              <p id="photo-help" className="mt-2 text-xs text-[#858e9d]">
                Photograph the full front headlight in good lighting and keep the damage visible.
              </p>
            )}
            {photo && !savedRequest ? <PhotoAnalysis key={`${photoRevision}:${form.model}:${form.year}`} photo={photo}
              model={form.model} year={form.year} disabled={isSubmitting}
              onChoosePhoto={() => photoInputRef.current?.click()}
              selectedSide={form.side === headlightSides[0].value ? "left" : form.side === headlightSides[1].value ? "right" : form.side ? "unknown" : null}
              onSelectSide={side => updateField("side", side === "left" ? headlightSides[0].value : side === "right" ? headlightSides[1].value : headlightSides[2].value)} /> : null}
          </div>
        </div>

        <div className="mt-7 rounded-[10px] border border-[#dfe3e9] bg-[#f8f9fc] p-4">
          <p id="privacy-help" className="text-xs leading-5 text-[#657083]">
            PartMatch stores your name, vehicle details, optional VIN and photo to process your request.
            These details may be shared with participating sellers to identify a compatible headlight.
            Upload only a photo you have permission to share. Avoid faces, license plates, documents
            and location metadata in the photo. Choosing a file alone does not upload it. Analyze photo sends
            the photo, model and year for local AI processing. Submit request sends your details and photo for seller review.
          </p>
          <label className="mt-3 flex items-start gap-3 text-sm text-[#344054]">
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
                setErrors((current) => ({ ...current, consent: undefined }));
              }}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={errors.consent ? "privacy-help consent-error" : "privacy-help"}
              className="mt-1 size-4 shrink-0 accent-[#536ee8]"
            />
            I have permission to share these details and photo, and agree to their storage and sharing
            with participating sellers for this request.
          </label>
          {errors.consent ? <p id="consent-error" className="mt-2 text-xs text-[#c64b4b]">{errors.consent}</p> : null}
        </div>
        </fieldset>

        <p role="status" className="mt-3 text-sm text-[#657083]">
          {isSubmitting ? "Submitting your request and photo. Please wait…" : ""}
        </p>

        {submitError ? (
          <div
            ref={feedbackRef}
            tabIndex={-1}
            role="alert"
            className="mt-7 flex items-start gap-3 rounded-[10px] border border-[#efc4c4] bg-[#fff7f7] p-4 text-[#a23f3f]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f8dddd] text-sm font-semibold">
              !
            </span>
            <div>
              <p className="text-sm font-semibold">Submission failed</p>
              <p className="mt-1 text-xs leading-5 text-[#a65b5b]">{submitError}</p>
              {sessionExpired ? <a href="/sign-in" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold underline">Sign in in a new tab, then return here and retry</a> : null}
            </div>
          </div>
        ) : null}

        {savedRequest ? (
          <div ref={feedbackRef} tabIndex={-1} role="status" aria-live="polite" className="mt-7 flex items-start gap-3 rounded-[10px] border border-[#bcded2] bg-[#f4faf8] p-4 text-[#286c59]">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#34866f] text-white">
              <CheckIcon />
            </span>
            <div>
              <p className="text-sm font-semibold">Request and photo submitted successfully</p>
              <p className="mt-1 text-xs leading-5 text-[#577f74]">
                Reference <span className="break-all font-mono">{savedRequest.requestId}</span> · {savedRequest.vehicle.customerName} · {savedRequest.vehicle.year} {savedRequest.vehicle.model} · {savedRequest.vehicle.side} · {savedRequest.photoName}
                {savedRequest.vehicle.vin ? ` · VIN ending in ${savedRequest.vehicle.vin.slice(-4)}` : " · No VIN provided"}.
              </p>
              <p className="mt-2 text-xs leading-5">
                Status: {savedRequest.status.replaceAll("_", " ")} · Submitted {new Date(savedRequest.createdAt).toLocaleString()}.
                Save your reference. Your request is ready for seller review; a match is not yet confirmed.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-9 flex flex-col-reverse gap-4 border-t border-[#e8eaee] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs leading-5 text-[#858e9d]">
            <LockIcon />
            Your VIN is used only for compatibility checks.
          </p>
          {savedRequest ? (
            <button type="button" onClick={() => {
              setSavedRequest(null);
              setForm(initialForm);
              setConsent(false);
              removePhoto();
              setErrors({});
              requestAnimationFrame(() => document.getElementById("customer-name")?.focus());
            }} className="h-12 rounded-[10px] bg-[#536ee8] px-6 text-sm font-semibold text-white">
              Start another request
            </button>
          ) : <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-[#536ee8] px-6 text-sm font-semibold text-white shadow-[0_3px_8px_rgba(83,110,232,0.22)] transition hover:bg-[#465dcc] hover:shadow-[0_5px_12px_rgba(83,110,232,0.24)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/20 active:translate-y-px disabled:cursor-wait disabled:bg-[#8e9de2] disabled:shadow-none"
          >
            {isSubmitting ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                Submitting request...
              </>
            ) : (
              <>
                Submit request and photo
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="2">
                  <path d="M4 10h11M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>}
        </div>
      </form>
    </div>
  );
}
