import { Request, Response } from 'express';
import { FormConfig } from '../types/form-types';
import { centralConfigService } from '../config/central-config';
import { updateSession, updateMainSessionWithFormSubmission } from '../services/session-service';
import { callMockService } from '../utils/mock-service';
import ejs from 'ejs';
import { randomUUID } from 'crypto';
import logger from '@ondc/automation-logger';

export const getForm = async (req: Request, res: Response) => {
  const { domain, formUrl } = req.params;
  const { session_id, flow_id, transaction_id, direct } = req.query;
  // Determine the actual form URL to look up
  const actualFormUrl = domain ? `${domain}/${formUrl}` : formUrl;
  console.log("actualFormUrl", domain, formUrl, actualFormUrl);
  const formConfig = await centralConfigService.getFormConfig(actualFormUrl);
  console.log("formConfig", formConfig);
  if (!formConfig) {
    return res.status(404).json({ error: 'Form not found' });
  }

  const formServiceConfig = centralConfigService.getFormServiceConfig();

  if (formConfig.type === 'dynamic' && !direct) {
    const formRenderUrl = `${formServiceConfig.baseUrl}/forms/${actualFormUrl}?flow_id=${flow_id}&session_id=${session_id}&transaction_id=${transaction_id}&direct=true`;

    return res.json({
      success: true,
      type: 'dynamic',
      formUrl: formRenderUrl,
      message: 'Please open this URL to fill the form'
    });
  }

  // Render HTML for static forms OR dynamic forms with direct=true
  const submitUrl = `${formServiceConfig.baseUrl}/forms/${actualFormUrl}/submit?flow_id=${flow_id}&session_id=${session_id}&transaction_id=${transaction_id}`;

  // Always load the form HTML from the config-specified path
  const htmlContent = formConfig.content;
  const submissionData = {
    session_id: session_id,
    transaction_id: transaction_id,
    flow_id: flow_id,
  };

  const newContent = ejs.render(htmlContent, {
    actionUrl: submitUrl,
    submissionData: JSON.stringify(submissionData),
    transactionId: transaction_id,
  });

  return res.type('html').send(newContent);
};

export const submitForm = async (req: Request, res: Response) => {
  const { domain, formUrl } = req.params;
  const formData = req.body;

  console.log("form submitted successfully");
  const { session_id, flow_id, transaction_id } = req.query

  if (!session_id || !flow_id || !transaction_id) {
    return res.status(400).send({ error: true, message: "session_id or flow_id or transaction_id not found in submission url " })
  }

  const submissionData: any = {
    session_id: session_id,
    flow_id: flow_id,
    transaction_id: transaction_id
  }

  // Determine the actual form URL to look up
  const actualFormUrl = domain ? `${domain}/${formUrl}` : formUrl;

  const formConfig = await centralConfigService.getFormConfig(actualFormUrl);

  if (!formConfig) {
    return res.status(404).json({ error: 'Form not found' });
  }

  try {
    // Update session with form data using the custom function
    console.log('Updating session with form data:', formData);
    const submission_id = randomUUID();
    formData.form_submission_id = submission_id;
    await updateSession(formConfig.url, formData, submissionData.transaction_id);
    await updateSession(formConfig.url, formData, submissionData.session_id);
    console.log('Session updated successfully');

    // Only for dynamic forms: update main session and show success page
    if (formConfig.type === 'dynamic') {
      // Update the main session data to mark form as submitted (for frontend polling)
      // await updateMainSessionWithFormSubmission(submissionData.session_id as string, submissionData.transaction_id as string, submission_id);
      await updateMainSessionWithFormSubmission(submissionData.session_id as string, submissionData.transaction_id as string, submission_id, formUrl);
      console.log('Main session updated with form submission status');

      // DO NOT call mock service here - let frontend handle proceed
      // This keeps the flow in INPUT-REQUIRED state so DynamicFormHandler can detect and proceed
      console.log('⏭️ Skipping mock service call for dynamic form - frontend will handle proceed');

      // Return a nice success page for dynamic forms
      const successHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Form Submitted Successfully</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .success-container {
              text-align: center;
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
            }
            .success-icon {
              font-size: 4rem;
              color: #10b981;
              margin-bottom: 1rem;
              animation: scaleIn 0.5s ease-out;
            }
            h1 {
              color: #1f2937;
              margin-bottom: 0.5rem;
            }
            p {
              color: #6b7280;
              margin-bottom: 2rem;
            }
            .submission-id {
              background: #f3f4f6;
              padding: 0.75rem;
              border-radius: 0.5rem;
              font-family: monospace;
              font-size: 0.875rem;
              color: #374151;
              margin-bottom: 1.5rem;
            }
            button {
              background: #667eea;
              color: white;
              border: none;
              padding: 0.75rem 2rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              cursor: pointer;
              transition: background 0.2s;
            }
            button:hover {
              background: #5568d3;
            }
            @keyframes scaleIn {
              from {
                transform: scale(0);
              }
              to {
                transform: scale(1);
              }
            }
          </style>
          <script>
            // Auto-close after 5 seconds
            setTimeout(function() {
              window.close();
            }, 5000);
          </script>
        </head>
        <body>
          <div class="success-container">
            <div class="success-icon">✓</div>
            <h1>Form Submitted Successfully!</h1>
            <p>Your form has been submitted and the flow will continue automatically.</p>
            <div class="submission-id">
              Submission ID: ${submission_id}
            </div>
            <p style="font-size: 0.875rem; color: #9ca3af;">
              This window will close automatically in 5 seconds...
            </p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
        </html>
      `;

      await callMockService(domain, submissionData, submission_id);
      // res.json({ success: true, submission_id: submission_id });

      res.type('html').send(successHtml);
    } else {
      // For static forms: keep original JSON response
      await callMockService(domain, submissionData, submission_id);
      res.json({ success: true, submission_id: submission_id });
    }
  } catch (error: any) {
    logger.error('Form submission error:', error)
    res.status(500).json({ error: 'Failed to process form submission' });
  }
};
