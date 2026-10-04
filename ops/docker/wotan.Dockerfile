# WOTAN static site on GKE (K8S-MV-03). /api -> IDUNA and /DEADWEIGHT/ws -> the DEADWEIGHT bridge are Gateway path routes
# (EMILY/gitops render.sh), so this is only the static files.
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY site/ /usr/share/nginx/html/
RUN printf "#!/bin/sh\nexec nginx -g \"daemon off;\"\n" > /run-nginx.sh && chmod +x /run-nginx.sh
RUN chmod -R a+rX /usr/share/nginx/html
