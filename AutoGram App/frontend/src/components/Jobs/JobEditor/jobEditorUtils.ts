export interface JobProfile {
  name: string;
  config: any;
}

export interface JobEditorProps {
  onCancel: () => void;
  onStart: (config: any) => void;
  initialJob?: any;
}
