# Recall Privacy Policy

*Last updated: 2026-09-08*

## Our Privacy-First Commitment

Recall is built on the principle that your meeting data should remain private and under your control. This privacy policy explains how we handle data in our open-source meeting assistant.

## Data Processing Philosophy

### Local-First Processing
- **Meeting transcription**: Processed entirely on your device using local Whisper or Parakeet models
- **Audio recordings**: Never transmitted to external servers
- **Meeting content**: Remains on your infrastructure
- **AI summaries**: Generated locally or through your chosen LLM provider

### Your Data Ownership
- You own all meeting data, transcripts, and recordings
- Data is stored locally on your device
- No vendor lock-in - export your data anytime
- Complete control over data retention and deletion

## Usage Analytics

Recall ships with **no product analytics telemetry**. There is no analytics
provider, no usage-data collection, and no telemetry consent screen.

- Recall does not send usage data, feature-usage patterns, session
  information, or performance metrics to any external service.
- Recall does not create a persistent user or session identifier for
  analytics purposes.
- Application logs remain on your device and are used only for local
  diagnostics.
- Automatic application updating is disabled until Recall-controlled
  release infrastructure exists; Recall never downloads updates from
  third-party release channels.

### What We DON'T Collect

There is no collection of:

- ❌ Meeting content, transcripts, or recordings
- ❌ Meeting titles, notes, summaries, or Context memory
- ❌ Personal information or identifiable data
- ❌ File names, file paths, or device names
- ❌ Audio data or voice patterns
- ❌ Participant names or contact information
- ❌ LLM conversations, prompts, or AI-generated content
- ❌ Search queries, tasks, decisions, or questions

## Third-Party Services

### LLM Providers (Optional)
If you choose to use external LLM providers:
- **Anthropic Claude**: Subject to Anthropic's privacy policy
- **Groq**: Subject to Groq's privacy policy
- **Local Ollama**: Processed entirely on your device

## Your Privacy Rights

### Data Control
- **Access**: View all data stored locally on your device
- **Export**: Export your data in standard formats
- **Delete**: Remove all data from your device


### Analytics Transparency
- **Open source**: Full source code available for review
- **No telemetry**: Recall contains no product analytics implementation

## Data Security

### Local Security
- Data encrypted at rest using your device's security features
- No transmission of sensitive meeting data
- Standard file system permissions protect your data

### Open Source Transparency
- Full source code available for security review
- Community-audited privacy implementations
- No hidden data collection or tracking

## Changes to This Policy

We will notify users of any material changes to this privacy policy through:
- Updates to this document in our GitHub repository
- Release notes for application updates
- In-app notifications for significant privacy changes

## Contact Us

For privacy-related questions or concerns:
- **GitHub Issues**: [Create an issue](https://github.com/nipungoel24/Recall/issues) (upstream history: [Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes/issues))
- **Email**: [Contact form](https://www.zackriya.com/service-interest-form/)
- **Community**: [Discord](https://discord.gg/crRymMQBFH)

## Open Source Commitment

As an open-source project under MIT license, you can:
- Review our complete privacy implementation
- Modify data handling to meet your requirements
- Deploy entirely on your own infrastructure
- Contribute to privacy improvements

---

*This privacy policy applies to Recall (formerly Meetily) v0.0.5 and later versions. For enterprise deployments, additional privacy controls may be available.*
