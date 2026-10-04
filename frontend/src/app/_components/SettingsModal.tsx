import { ModelConfig } from "@/components/ModelSettingsModal";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { DeviceSelection } from "@/components/DeviceSelection";
import { LanguageSelection } from "@/components/LanguageSelection";
import { TranscriptSettings } from "@/components/TranscriptSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";

type modalType = "modelSettings" | "deviceSettings" | "languageSettings" | "modelSelector" | "errorAlert" | "chunkDropWarning";

/**
 * SettingsModals Component
 *
 * All settings modals consolidated into a single component.
 * Uses ConfigContext and RecordingStateContext internally - no prop drilling needed!
 *
 * Every modal is built on the shared Radix `Dialog` primitive so that focus is
 * trapped, Escape and scrim clicks dismiss, focus returns to the trigger on
 * close, and the dialog is correctly exposed as `role="dialog" aria-modal="true"`
 * with an accessible name.
 */

interface SettingsModalsProps {
  modals: {
    modelSettings: boolean;
    deviceSettings: boolean;
    languageSettings: boolean;
    modelSelector: boolean;
    errorAlert: boolean;
    chunkDropWarning: boolean;
  };
  messages: {
    errorAlert: string;
    chunkDropWarning: string;
    modelSelector: string;
  };
  onClose: (name: modalType) => void;
}

const SELECT_CLASS =
  "px-3 py-2 text-sm bg-surface border border-border rounded-md shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

export function SettingsModals({
  modals,
  messages,
  onClose,
}: SettingsModalsProps) {
  // Contexts
  const {
    modelConfig,
    setModelConfig,
    models,
    modelOptions,
    error,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    transcriptModelConfig,
    setTranscriptModelConfig,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
  } = useConfig();

  const { isRecording } = useRecordingState();

  return <>
    {/* Legacy Settings Modal */}
    <Dialog
      open={modals.modelSettings}
      onOpenChange={(open) => { if (!open) onClose("modelSettings"); }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="p-6 border-b">
          <DialogTitle className="text-xl font-semibold text-foreground">
            Preferences
          </DialogTitle>
        </DialogHeader>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* General Preferences Section */}
          <PreferenceSettings />

          {/* Divider */}
          <div className="border-t pt-8">
            <h3 className="text-section-title text-foreground mb-4">AI Model Configuration</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="summarization-provider" className="block text-sm font-medium text-foreground mb-1">
                  Summarization Model
                </label>
                <div className="flex space-x-2">
                  <select
                    id="summarization-provider"
                    className={SELECT_CLASS}
                    value={modelConfig.provider}
                    onChange={(e) => {
                      const provider = e.target.value as ModelConfig['provider'];
                      setModelConfig({
                        ...modelConfig,
                        provider,
                        model: modelOptions[provider][0]
                      });
                    }}
                  >
                    <option value="builtin-ai">Built-in AI</option>
                    <option value="claude">Claude</option>
                    <option value="groq">Groq</option>
                    <option value="ollama">Ollama</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="openai">OpenAI</option>
                  </select>

                  <select
                    aria-label="Summarization model"
                    className={`flex-1 ${SELECT_CLASS}`}
                    value={modelConfig.model}
                    onChange={(e) => setModelConfig((prev: ModelConfig) => ({ ...prev, model: e.target.value }))}
                  >
                    {modelOptions[modelConfig.provider].map((model: string) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {modelConfig.provider === 'ollama' && (
                <div>
                  <h4 className="text-base font-semibold text-foreground mb-4">Available Ollama Models</h4>
                  {error && (
                    <div
                      role="alert"
                      className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-md mb-4"
                    >
                      {error}
                    </div>
                  )}
                  <div className="grid gap-4 max-h-[400px] overflow-y-auto pr-2">
                    {models.map((model) => {
                      const isSelected = modelConfig.model === model.name;
                      return (
                        <button
                          type="button"
                          key={model.id}
                          aria-pressed={isSelected}
                          className={`bg-surface p-4 rounded-lg shadow text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-background'
                          }`}
                          onClick={() => setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }))}
                        >
                          <span className="block font-bold">{model.name}</span>
                          <span className="block text-muted-foreground">Size: {model.size}</span>
                          <span className="block text-muted-foreground">Modified: {model.modified}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="border-t p-6">
          <Button type="button" onClick={() => onClose('modelSettings')}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Device Settings Modal */}
    <Dialog
      open={modals.deviceSettings}
      onOpenChange={(open) => { if (!open) onClose('deviceSettings'); }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            Audio Device Settings
          </DialogTitle>
        </DialogHeader>

        <DeviceSelection
          selectedDevices={selectedDevices}
          onDeviceChange={setSelectedDevices}
          disabled={isRecording}
        />

        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              const micDevice = selectedDevices.micDevice || 'Default';
              const systemDevice = selectedDevices.systemDevice || 'Default';
              toast.success("Devices selected", {
                description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
              });
              onClose('deviceSettings');
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Language Settings Modal */}
    <Dialog
      open={modals.languageSettings}
      onOpenChange={(open) => { if (!open) onClose('languageSettings'); }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            Language Settings
          </DialogTitle>
        </DialogHeader>

        <LanguageSelection
          selectedLanguage={selectedLanguage}
          onLanguageChange={setSelectedLanguage}
          disabled={isRecording}
          provider={transcriptModelConfig.provider}
        />

        <DialogFooter>
          <Button type="button" onClick={() => onClose('languageSettings')}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Model Selection Modal */}
    <Dialog
      open={modals.modelSelector}
      onOpenChange={(open) => { if (!open) onClose('modelSelector'); }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
        {/* Fixed Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {messages.modelSelector ? 'Speech Recognition Setup Required' : 'Transcription Model Settings'}
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          <TranscriptSettings
            transcriptModelConfig={transcriptModelConfig}
            setTranscriptModelConfig={setTranscriptModelConfig}
            onModelSelect={() => onClose('modelSelector')}
          />
        </div>

        {/* Fixed Footer */}
        <DialogFooter className="p-6 pt-4 border-t border-border">
          {/* Confidence Indicator Toggle */}
          <div className="flex items-center gap-3 mr-auto">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showConfidenceIndicator}
                onChange={(e) => toggleConfidenceIndicator(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-primary-foreground after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:bg-primary"></div>
            </label>
            <div>
              <p className="text-sm font-medium text-foreground">Show Confidence Indicators</p>
              <p className="text-xs text-muted-foreground">Display colored dots showing transcription confidence quality</p>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => onClose('modelSelector')}
          >
            {messages.modelSelector ? 'Cancel' : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Error Alert Modal */}
    <Dialog
      open={modals.errorAlert}
      onOpenChange={(open) => { if (!open) onClose('errorAlert'); }}
    >
      <DialogContent className="max-w-md">
        {/* The visible heading lives inside the Alert; this gives the dialog its
            accessible name without changing what is rendered. */}
        <DialogTitle className="sr-only">Recording Stopped</DialogTitle>
        <Alert variant="destructive" className="border-destructive/30 bg-surface">
          <AlertTitle>Recording Stopped</AlertTitle>
          <AlertDescription>
            {messages.errorAlert}
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose('errorAlert')}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Chunk Drop Warning Modal */}
    <Dialog
      open={modals.chunkDropWarning}
      onOpenChange={(open) => { if (!open) onClose('chunkDropWarning'); }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="sr-only">Transcription Performance Warning</DialogTitle>
        <Alert className="border-warning/30 bg-surface">
          <AlertTitle className="text-warning">Transcription Performance Warning</AlertTitle>
          <AlertDescription className="text-warning">
            {messages.chunkDropWarning}
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose('chunkDropWarning')}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
