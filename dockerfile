FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY fight_cancer_logo.png /usr/share/nginx/html/fight_cancer_logo.png
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]