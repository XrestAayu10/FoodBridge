# AaharLink EmailJS Setup

This project currently uses two EmailJS templates:

| Purpose | Template ID in the code |
|---|---|
| Pickup accepted | `template_9kx2jim` |
| Pickup completed | `template_63zfaze` |

The project uses EmailJS's `default_service`. In **Email Services**, connect a Gmail account, make it the default service, and successfully run **Test Service** before configuring the templates.

## Common fields for both templates

Open a template and configure the panel on the right:

- **To Email:** `{{to_email}}`
- **From Name:** `AaharLink`
- **From Email:** keep **Use Default Email Address** selected
- **Reply To:** `{{reply_to}}`
- **Bcc:** empty
- **Cc:** empty

Do not type a fixed personal Gmail address into **To Email**. The application supplies the correct supplier or organization address through `{{to_email}}`.

## Template 1: Pickup accepted

Open template `template_9kx2jim`.

### Settings

- **Template name:** `Pickup Accepted`
- Keep the Template ID unchanged.

### Subject

```text
Pickup accepted — {{food_name}}
```

### Content

Click **Edit Content**, remove the default Contact Us content, and paste:

```text
Hello {{recipient_name}},

The pickup request for {{food_name}} has been accepted.

Your role: {{recipient_role}}
Quantity: {{quantity}}
Pickup location: {{pickup_location}}
Pickup deadline: {{pickup_deadline}}
Pickup partner: {{partner_name}}
Partner email: {{partner_email}}
Partner phone: {{partner_phone}}

Pickup code: {{pickup_code}}

The organization should show the pickup code at handover. The supplier should enter that code in AaharLink. The organization must also confirm that the food was received.

Thank you for rescuing food with AaharLink.
```

For security, the organization receives the real pickup code. The supplier's copy says that the code is shown only to the organization.

### Test values

When EmailJS asks for test variables, use:

```json
{
  "to_email": "YOUR_TEST_EMAIL@gmail.com",
  "reply_to": "YOUR_TEST_EMAIL@gmail.com",
  "recipient_name": "Hope Relief Nepal",
  "recipient_role": "Organization",
  "food_name": "50 Veg Meal Boxes",
  "quantity": "50 portions",
  "pickup_location": "Thamel, Kathmandu",
  "pickup_deadline": "Sep 13, 4:30 PM",
  "partner_name": "Himalayan Catering",
  "partner_email": "YOUR_TEST_EMAIL@gmail.com",
  "partner_phone": "+977-9800000001",
  "pickup_code": "AHL-482913"
}
```

## Template 2: Pickup completed

Open template `template_63zfaze`.

### Settings

- **Template name:** `Pickup Completed`
- Keep the Template ID unchanged.

### Subject

```text
Pickup completed — {{food_name}}
```

### Content

Click **Edit Content**, remove the default Contact Us content, and paste:

```text
Hello {{recipient_name}},

The food pickup has been confirmed by both the supplier and the organization.

Status: {{status}}
Food: {{food_name}}
Quantity: {{quantity}}
Pickup location: {{pickup_location}}
Supplier: {{supplier_name}}
Organization: {{organization_name}}
Pickup partner: {{partner_name}}
Partner email: {{partner_email}}
Partner phone: {{partner_phone}}
Completed at: {{completed_at}}
Pickup reference: {{pickup_reference}}

Please keep this email as the pickup receipt.

Thank you for rescuing food with AaharLink.
```

### Test values

```json
{
  "to_email": "YOUR_TEST_EMAIL@gmail.com",
  "reply_to": "YOUR_TEST_EMAIL@gmail.com",
  "recipient_name": "Himalayan Catering",
  "recipient_role": "Supplier",
  "status": "Collected",
  "food_name": "50 Veg Meal Boxes",
  "quantity": "50 portions",
  "pickup_location": "Thamel, Kathmandu",
  "supplier_name": "Himalayan Catering",
  "organization_name": "Hope Relief Nepal",
  "partner_name": "Hope Relief Nepal",
  "partner_email": "YOUR_TEST_EMAIL@gmail.com",
  "partner_phone": "+977-9800000002",
  "completed_at": "Sep 13, 5:10 PM",
  "pickup_reference": "demo-request-123"
}
```

## Save and test

For each template:

1. Click **Save**.
2. Click **Test It** and enter the test variables above.
3. Confirm the test message arrives; check Spam once if necessary.
4. In AaharLink, hard-refresh with `Ctrl+Shift+R`.
5. Create a new listing and a new pickup request.
6. Accept it as the supplier. Two accepted emails should be sent, about 1.1 seconds apart.
7. Confirm receipt as the organization and enter the code as the supplier. When the second confirmation changes the request to `collected`, two completed emails should be sent.

Existing accepted or collected records do not automatically resend old emails.

## Troubleshooting

- **Service ID not found:** verify Gmail is connected and marked Default under **Email Services**.
- **Template ID not found:** confirm the template ID exactly matches `js/notifications.js`.
- **Recipient address is corrupted:** ensure **To Email** is exactly `{{to_email}}` and **Reply To** is exactly `{{reply_to}}`.
- **Only one of two emails arrives:** wait a moment and check Email History; the application spaces the two sends to respect EmailJS rate limiting.
- **No send request appears:** the relevant action may already have happened. Use a new pickup for a full test.

Never put an EmailJS private key in browser JavaScript. This project needs only the public key, default service, and template IDs.
